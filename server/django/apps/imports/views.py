import os

from django.http import JsonResponse

from apps.imports.middleware import json_api, normalize_doi, normalize_orcid, parse_json_body
from .services.bibliography import (
    DEFAULT_STYLE_ID,
    build_document_citations,
    export_collection_bibliography,
    export_items_bibliography,
    list_styles,
    resolve_style_id,
    style_label,
)
from .services.orcid import import_orcid_works
from .services.studies import StudiesConfigError, list_studies, resolve_collection_key
from .services.exceptions import ZoteroClientError
from .services.debug_trace import (
    build_document_citations_debug,
    dedupe_collection_items_by_doi,
    trace_item_citation,
)
from .services.zotero import ZoteroClient, get_zotero_client
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


def _live_payload() -> dict:
    """Szybki ping Django — bez wywołań Zotero (liveness / kropka API w sidebarze)."""
    return {
        "status": "ok",
        "service": "zotero20-api",
        # Tag obrazu — bez tego nie da się odróżnić „wdrożone” od „wdrożone, ale stare”.
        "build": os.environ.get("ZOTERO20_BUILD", "unknown"),
    }


def _health_payload(verbose: bool = False) -> tuple[dict, bool]:
    if web_api_configured():
        from .services.zotero_web import ZoteroWebClient

        client = ZoteroWebClient()
        zotero = client.health_summary()
        ok = "error" not in zotero
    else:
        client = ZoteroClient()
        zotero = client.health_summary()
        ok = "ping" in zotero and zotero["ping"] is not None

    payload = {
        "status": "ok" if ok else "degraded",
        "service": "zotero20-api",
        "build": os.environ.get("ZOTERO20_BUILD", "unknown"),
        "zotero": zotero,
    }
    if verbose:
        payload["verbose"] = True
        payload["web_api_configured"] = web_api_configured()
        payload["styles_count"] = len(list_styles())
        payload["default_style"] = DEFAULT_STYLE_ID
    return payload, ok


def _zotero_reachability_payload() -> tuple[dict, bool]:
    """Lekki check Django ↔ Zotero (Web API lub Local)."""
    try:
        if web_api_configured():
            from .services.zotero_web import ZoteroWebClient

            zotero = ZoteroWebClient().reachability_check(timeout=5.0)
        else:
            zotero = ZoteroClient(timeout=5).reachability_check(timeout=5.0)
        return {"status": "ok", "zotero": zotero}, True
    except ZoteroClientError as exc:
        api = "web" if web_api_configured() else "local"
        return {
            "status": "error",
            "zotero": {
                "api": api,
                "reachable": False,
                "user_id": None,
                "error": str(exc),
            },
        }, False
    except Exception as exc:  # noqa: BLE001 — health nie może padać 500 na timeoutach sieci
        api = "web" if web_api_configured() else "local"
        return {
            "status": "error",
            "zotero": {
                "api": api,
                "reachable": False,
                "user_id": None,
                "error": str(exc),
            },
        }, False


@json_api
def health(request):
    """Liveness API (bez Zotero). Pełny diagnostyczny payload: ?verbose=1 lub /debug/health."""
    verbose = request.GET.get("verbose") in ("1", "true", "yes")
    if verbose:
        payload, ok = _health_payload(verbose=True)
        return JsonResponse(payload, status=200 if ok else 503)
    return JsonResponse(_live_payload())


@json_api
def health_live(request):
    """Alias publicznego pinga — to samo co GET /health bez verbose."""
    return JsonResponse(_live_payload())


@json_api
def health_zotero(request):
    """Lekki check połączenia z Zotero (wymaga X-API-Key — trafia w zotero.org / Local API)."""
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)
    payload, ok = _zotero_reachability_payload()
    return JsonResponse(payload, status=200 if ok else 503)


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
        existing = client.find_item_in_collection_by_doi(doi, collection_key)
        if existing:
            return JsonResponse(
                {
                    "duplicate": True,
                    "message": "Pozycja już w kolekcji",
                    "doi": doi,
                    "collection_key": collection_key,
                    "source": source,
                    "item_key": existing.get("key", ""),
                    "title": existing.get("title", ""),
                    "citation_text": existing.get("citation_text", ""),
                    "in_collection": True,
                }
            )

        lib_existing = client.find_item_by_doi(doi)
        if lib_existing and lib_existing.get("key"):
            return JsonResponse(
                {
                    "duplicate": True,
                    "message": "Pozycja z tym DOI już jest w bibliotece Zotero",
                    "doi": doi,
                    "collection_key": collection_key,
                    "source": source,
                    "item_key": lib_existing.get("key", ""),
                    "title": lib_existing.get("title", ""),
                    "citation_text": lib_existing.get("citation_text", ""),
                    "in_collection": False,
                }
            )

        result = client.add_item_by_id(doi, collection_key)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    if isinstance(result, dict) and result.get("duplicate"):
        existing = result.get("existing") or {}
        return JsonResponse(
            {
                "duplicate": True,
                "message": "Pozycja już w kolekcji",
                "doi": doi,
                "collection_key": collection_key,
                "source": source,
                "item_key": result.get("key", ""),
                "title": existing.get("title", ""),
                "citation_text": existing.get("citation_text", ""),
                "result": result,
            }
        )

    item_key = ""
    citation_text = ""
    if isinstance(result, dict):
        item_key = result.get("key") or result.get("itemKey") or ""
        existing = result.get("existing") or {}
        if existing.get("citation_text"):
            citation_text = existing["citation_text"]

    response = {
        "success": True,
        "doi": doi,
        "collection_key": collection_key,
        "source": source,
        "result": result,
        "item_key": item_key,
        "citation_text": citation_text,
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
        if normalize_doi(orcid_raw):
            return JsonResponse(
                {
                    "error": (
                        "To wygląda na DOI artykułu, nie identyfikator ORCID. "
                        "Użyj zakładki „Pojedynczy DOI”."
                    )
                },
                status=400,
            )
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


@json_api
def collection_items(request):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    collection_key = (request.GET.get("collection_key") or "").strip()
    if not collection_key:
        return JsonResponse({"error": "Wymagany parametr: collection_key."}, status=400)

    limit = int(request.GET.get("limit", 20))
    limit = max(1, min(limit, 100))

    dedupe = request.GET.get("dedupe_doi", "1") not in ("0", "false", "no")
    client, source = get_zotero_client()
    try:
        items = client.list_collection_items(collection_key, limit=limit)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    hidden_duplicates = 0
    if dedupe:
        items, hidden_duplicates = dedupe_collection_items_by_doi(items)

    response = {
        "collection_key": collection_key,
        "source": source,
        "items": items,
    }
    if hidden_duplicates:
        response["hidden_duplicate_dois"] = hidden_duplicates
        response["doi_dedup_note"] = (
            "Zotero nie blokuje duplikatów DOI w kolekcji — serwer ukrywa powtórki na liście."
        )
    return JsonResponse(response)


@json_api
def collection_item_remove(request, collection_key: str, item_key: str):
    if request.method != "DELETE":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    collection_key = (collection_key or "").strip()
    item_key = (item_key or "").strip()
    if not collection_key:
        return JsonResponse({"error": "Wymagany klucz kolekcji."}, status=400)
    if not item_key:
        return JsonResponse({"error": "Wymagany klucz pozycji."}, status=400)

    client, source = get_zotero_client()
    try:
        result = client.remove_item_from_collection(collection_key, item_key)
    except ZoteroClientError as exc:
        status = 404 if exc.status_code == 404 else 502
        return JsonResponse({"error": str(exc)}, status=status)

    result["source"] = source
    return JsonResponse(result)


@json_api
def styles_list(request):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)
    return JsonResponse({"styles": list_styles(), "default": DEFAULT_STYLE_ID})


MAX_DOCUMENT_ITEM_KEYS = 150


def _parse_item_keys(raw_item_keys):
    """Zwraca (item_keys, error_response). Pusta lista nigdy nie oznacza „weź całą kolekcję”."""
    if not isinstance(raw_item_keys, list):
        return None, JsonResponse({"error": "Pole item_keys musi być tablicą."}, status=400)
    item_keys = [str(key).strip() for key in raw_item_keys if str(key).strip()]
    if not item_keys:
        return None, JsonResponse({"error": "Wymagana niepusta lista item_keys."}, status=400)
    if len(item_keys) > MAX_DOCUMENT_ITEM_KEYS:
        return None, JsonResponse(
            {
                "error": f"Maksymalnie {MAX_DOCUMENT_ITEM_KEYS} pozycji "
                "w jednym żądaniu bibliografii."
            },
            status=400,
        )
    return item_keys, None


@json_api
def citations_generate(request):
    """Cytowania w tekście + bibliografia dla pozycji cytowanych w dokumencie (jeden styl)."""
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    try:
        style = resolve_style_id(body.get("style"))
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    item_keys, error = _parse_item_keys(body.get("item_keys"))
    if error is not None:
        return error

    client, source = get_zotero_client()
    try:
        payload = build_document_citations(client, source, item_keys, style)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)
    return JsonResponse(payload)


@json_api
def bibliography_generate(request):
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    try:
        style = resolve_style_id(body.get("style"))
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    raw_item_keys = body.get("item_keys")
    if raw_item_keys is not None:
        item_keys, error = _parse_item_keys(raw_item_keys)
        if error is not None:
            return error
        client, source = get_zotero_client()
        try:
            payload = export_items_bibliography(client, source, item_keys, style)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        except ZoteroClientError as exc:
            return JsonResponse({"error": str(exc)}, status=502)
        return JsonResponse(payload)

    collection_key = (body.get("collection_key") or "").strip()
    if not collection_key:
        return JsonResponse(
            {"error": "Wymagane pole: collection_key lub item_keys."},
            status=400,
        )

    client, source = get_zotero_client()
    try:
        payload = export_collection_bibliography(client, source, collection_key, style)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    return JsonResponse(payload)


@json_api
def item_detail(request, item_key):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    style = (request.GET.get("style") or "").strip()
    client, source = get_zotero_client()

    if style:
        try:
            resolved_style = resolve_style_id(style)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        try:
            citation_text = client.fetch_item_citation(item_key, resolved_style)
        except ZoteroClientError as exc:
            return JsonResponse({"error": str(exc)}, status=502)
        return JsonResponse(
            {
                "source": source,
                "item_key": item_key,
                "style": resolved_style,
                "style_label": style_label(resolved_style),
                "citation_text": citation_text,
            }
        )

    try:
        item = client.get_item(item_key)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    if not item:
        return JsonResponse({"error": "Nie znaleziono pozycji."}, status=404)

    return JsonResponse({"source": source, "item": item})


@json_api
def debug_health(request):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)
    verbose = request.GET.get("verbose", "1") not in ("0", "false", "no")
    payload, ok = _health_payload(verbose=verbose)
    payload["endpoint"] = "debug/health"
    return JsonResponse(payload, status=200 if ok else 503)


@json_api
def debug_item(request, item_key):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    style = (request.GET.get("style") or "").strip()
    client, source = get_zotero_client()
    try:
        item = client.get_item(item_key)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    if not item:
        return JsonResponse({"error": "Nie znaleziono pozycji."}, status=404)

    citation_trace = trace_item_citation(client, item_key, style or None)
    payload = {
        "source": source,
        "item_key": item_key,
        "item": item,
        "doi": item.get("doi", ""),
        "citation_trace": citation_trace,
    }
    if style:
        try:
            resolved_style = resolve_style_id(style)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        payload["style"] = resolved_style
        payload["style_label"] = style_label(resolved_style)
    return JsonResponse(payload)


@json_api
def debug_citations(request):
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    try:
        style = resolve_style_id(body.get("style"))
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    item_keys, error = _parse_item_keys(body.get("item_keys"))
    if error is not None:
        return error

    client, source = get_zotero_client()
    try:
        payload = build_document_citations_debug(client, source, item_keys, style)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except ZoteroClientError as exc:
        return JsonResponse({"error": str(exc)}, status=502)
    return JsonResponse(payload)


@json_api
def debug_styles(request):
    if request.method != "GET":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)
    return JsonResponse(
        {
            "styles": list_styles(),
            "default": DEFAULT_STYLE_ID,
            "endpoint": "debug/styles",
        }
    )


@json_api
def debug_echo(request):
    if request.method != "POST":
        return JsonResponse({"error": "Metoda niedozwolona."}, status=405)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({"error": "Nieprawidłowy JSON."}, status=400)

    return JsonResponse(
        {
            "ok": True,
            "method": request.method,
            "path": request.path,
            "headers": {
                "x-api-key": "present" if request.headers.get("X-API-Key") else "missing",
                "authorization": "present" if request.headers.get("Authorization") else "missing",
                "content-type": request.headers.get("Content-Type", ""),
            },
            "body": body,
        }
    )
