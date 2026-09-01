from django.http import JsonResponse

from apps.imports.middleware import json_api, normalize_doi, normalize_orcid, parse_json_body
from .services.orcid import import_orcid_works
from .services.studies import StudiesConfigError, list_studies, resolve_collection_key
from .services.zotero import ZoteroClient, ZoteroClientError, get_zotero_client
from .services.zotero_web import web_api_configured


_COLLECTIONS_EMPTY_HINT_LOCAL = (
    "Serwer używa lokalnej biblioteki Zotero (Docker), nie zotero.org. "
    "Kolekcje z konta online pojawią się dopiero po synchronizacji Zotero na serwerze "
    "albo możesz podać 8-znakowy klucz kolekcji ręcznie (z URL zotero.org, np. …/collections/FVIAD3D8/collection)."
)
_COLLECTIONS_EMPTY_HINT_WEB = (
    "Konto zotero.org nie ma jeszcze kolekcji albo klucz API nie ma dostępu do biblioteki. "
    "Utwórz kolekcję w Zotero Desktop/Web i nadaj kluczowi API uprawnienia do biblioteki."
)


def _zotero_collections_payload() -> dict:
    client, source = get_zotero_client()
    try:
        items = client.list_collections()
        payload = {
            "available": True,
            "source": source,
            "items": items,
        }
        if not items:
            payload["empty"] = True
            payload["hint"] = (
                _COLLECTIONS_EMPTY_HINT_WEB if source == "web" else _COLLECTIONS_EMPTY_HINT_LOCAL
            )
        return payload
    except ZoteroClientError as exc:
        return {
            "available": False,
            "source": source,
            "error": str(exc),
        }


@json_api
def health(request):
    if web_api_configured():
        from .services.zotero_web import ZoteroWebClient

        client = ZoteroWebClient()
        zotero = client.health_summary()
        ok = "error" not in zotero
    else:
        client = ZoteroClient()
        zotero = client.health_summary()
        ok = "ping" in zotero and zotero["ping"] is not None
    return JsonResponse(
        {
            "status": "ok" if ok else "degraded",
            "service": "zotero20-api",
            "zotero": zotero,
        },
        status=200 if ok else 503,
    )


@json_api
def collections_list(request):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    payload = _zotero_collections_payload()
    if not payload.get("available"):
        return JsonResponse(
            {"error": payload.get("error", "Nie udało się pobrać kolekcji Zotero.")},
            status=502,
        )
    response = {"collections": payload["items"]}
    if payload.get("source"):
        response["source"] = payload["source"]
    if payload.get("hint"):
        response["hint"] = payload["hint"]
    return JsonResponse(response)


@json_api
def studies_list(request):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)
    try:
        payload = {"studies": list_studies()}
    except StudiesConfigError as exc:
        return JsonResponse({"error": str(exc)}, status=500)

    payload["zotero_collections"] = _zotero_collections_payload()
    return JsonResponse(payload)


@json_api
def import_doi(request):
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    doi_raw = body.get("doi", "")
    study = body.get("study", "")
    collection_key_raw = body.get("collection_key", "")
    if not doi_raw:
        return JsonResponse({"error": "Wymagane pole: doi."}, status=400)
    if not study and not collection_key_raw:
        return JsonResponse(
            {"error": "Wymagane pole: collection_key lub study."},
            status=400,
        )

    doi = normalize_doi(doi_raw)
    if not doi:
        return JsonResponse({"error": "Nieprawidłowy format DOI."}, status=400)

    try:
        collection_key, study = resolve_collection_key(
            study=study,
            collection_key=collection_key_raw,
        )
    except StudiesConfigError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    client, source = get_zotero_client()
    try:
        result = client.add_item_by_id(doi, collection_key)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    response = {
        "success": True,
        "doi": doi,
        "collection_key": collection_key,
        "source": source,
        "result": result,
    }
    if study:
        response["study"] = study
    return JsonResponse(response)


@json_api
def import_orcid(request):
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    orcid_raw = body.get("orcid", "")
    study = body.get("study", "")
    collection_key_raw = body.get("collection_key", "")
    limit = int(body.get("limit", 50))
    if not orcid_raw:
        return JsonResponse({"error": "Wymagane pole: orcid."}, status=400)
    if not study and not collection_key_raw:
        return JsonResponse(
            {"error": "Wymagane pole: collection_key lub study."},
            status=400,
        )

    orcid = normalize_orcid(orcid_raw)
    if not orcid:
        return JsonResponse({"error": "Nieprawidłowy format ORCID."}, status=400)

    limit = max(1, min(limit, 200))

    try:
        collection_key, study = resolve_collection_key(
            study=study,
            collection_key=collection_key_raw,
        )
    except StudiesConfigError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    report = import_orcid_works(
        orcid,
        study or collection_key,
        collection_key,
        limit=limit,
    )
    status = 200 if not report.errors or report.added else 502
    payload = report.to_dict()
    payload["collection_key"] = collection_key
    return JsonResponse(payload, status=status)
