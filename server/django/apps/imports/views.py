from django.http import JsonResponse

from apps.imports.middleware import json_api, normalize_doi, normalize_orcid, parse_json_body
from .services.orcid import import_orcid_works
from .services.studies import StudiesConfigError, get_collection_key, list_studies
from .services.zotero import ZoteroClient, ZoteroClientError


@json_api
def health(request):
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
def studies_list(request):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)
    try:
        return JsonResponse({"studies": list_studies()})
    except StudiesConfigError as exc:
        return JsonResponse({"error": str(exc)}, status=500)


@json_api
def import_doi(request):
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    doi_raw = body.get("doi", "")
    study = body.get("study", "")
    if not doi_raw or not study:
        return JsonResponse(
            {"error": "Wymagane pola: doi, study."},
            status=400,
        )

    doi = normalize_doi(doi_raw)
    if not doi:
        return JsonResponse({"error": "Nieprawidłowy format DOI."}, status=400)

    try:
        collection_key = get_collection_key(study)
    except StudiesConfigError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    client = ZoteroClient()
    try:
        result = client.add_item_by_id(doi, collection_key)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    return JsonResponse(
        {
            "success": True,
            "doi": doi,
            "study": study,
            "collection_key": collection_key,
            "result": result,
        }
    )


@json_api
def import_orcid(request):
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    orcid_raw = body.get("orcid", "")
    study = body.get("study", "")
    limit = int(body.get("limit", 50))
    if not orcid_raw or not study:
        return JsonResponse(
            {"error": "Wymagane pola: orcid, study."},
            status=400,
        )

    orcid = normalize_orcid(orcid_raw)
    if not orcid:
        return JsonResponse({"error": "Nieprawidłowy format ORCID."}, status=400)

    limit = max(1, min(limit, 200))

    try:
        collection_key = get_collection_key(study)
    except StudiesConfigError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    report = import_orcid_works(orcid, study, collection_key, limit=limit)
    status = 200 if not report.errors or report.added else 502
    return JsonResponse(report.to_dict(), status=status)
