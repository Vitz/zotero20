from __future__ import annotations

from django.conf import settings
from django.http import JsonResponse


class ApiCsrfExemptMiddleware:
    """
    Wyłącza CSRF dla endpointów chronionych X-API-Key (nie sesją Django).

    Zewnętrzni klienci (Google Apps Script, Connector) nie mają tokena CSRF.
    """

    API_PREFIX = "/api/v1/"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._exempt_from_csrf(request):
            setattr(request, "_dont_enforce_csrf_checks", True)
        return self.get_response(request)

    def _exempt_from_csrf(self, request) -> bool:
        path = request.path
        if path.startswith(self.API_PREFIX):
            return True
        return any(path.startswith(f"/{prefix}") for prefix in settings.ZOTERO_PROXY_PREFIXES)


class ApiKeyMiddleware:
    """
    Wymaga X-API-Key (lub Authorization: Bearer) dla:
    - /api/v1/* (import)
    - proxowane ścieżki Zotero (/connector/*, /api/users/*, …)

    Wyjątki: /app/ (sesja admin), /captcha/, /static/, health.
    """

    EXEMPT_PREFIXES = (
        "/app/",
        "/captcha/",
        "/static/",
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not self._requires_api_key(request):
            return self.get_response(request)

        if not settings.API_KEY:
            if settings.DEBUG:
                return self.get_response(request)
            return JsonResponse(
                {"error": "Serwer nie skonfigurowany (brak ZOTERO20_API_KEY)."},
                status=503,
            )

        provided = self._extract_key(request)
        if provided != settings.API_KEY:
            return JsonResponse({"error": "Nieprawidłowy klucz API."}, status=401)

        return self.get_response(request)

    def _requires_api_key(self, request) -> bool:
        path = request.path

        if any(path.startswith(prefix) for prefix in self.EXEMPT_PREFIXES):
            return False

        if path == "/api/v1/health":
            return False

        if path.startswith("/api/v1/"):
            return True

        return any(path.startswith(f"/{prefix}") for prefix in settings.ZOTERO_PROXY_PREFIXES)

    @staticmethod
    def _extract_key(request) -> str:
        key = request.headers.get("X-API-Key", "")
        if key:
            return key
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return ""
