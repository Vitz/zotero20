from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.http import HttpResponse, JsonResponse

logger = logging.getLogger(__name__)

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}

STRIP_REQUEST_HEADERS = {
    "x-api-key",
    "authorization",
    "cf-access-client-id",
    "cf-access-client-secret",
}


def zotero_proxy(request, zotero_path: str):
    """Reverse proxy do lokalnego Zotero — wymaga X-API-Key (middleware)."""
    query = request.META.get("QUERY_STRING", "")
    url = f"{settings.ZOTERO_URL}/{zotero_path}"
    if query:
        url = f"{url}?{query}"

    headers = {}
    for key, value in request.headers.items():
        lowered = key.lower()
        if lowered in HOP_BY_HOP or lowered in STRIP_REQUEST_HEADERS:
            continue
        headers[key] = value

    try:
        upstream = requests.request(
            method=request.method,
            url=url,
            headers=headers,
            data=request.body if request.method not in ("GET", "HEAD") else None,
            allow_redirects=False,
            timeout=120,
        )
    except requests.RequestException as exc:
        logger.exception("Zotero proxy error for %s", url)
        return JsonResponse(
            {"error": "Zotero niedostępne.", "detail": str(exc)},
            status=502,
        )

    response = HttpResponse(
        upstream.content,
        status=upstream.status_code,
        content_type=upstream.headers.get("Content-Type", "application/octet-stream"),
    )
    for key, value in upstream.headers.items():
        lowered = key.lower()
        if lowered in HOP_BY_HOP or lowered == "content-encoding":
            continue
        response[key] = value
    return response
