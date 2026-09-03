import json

import pytest
import responses
from django.test import override_settings

from tests.helpers.zotero_mock import register_exec_command, register_local_zotero_base


@pytest.mark.django_db
class TestApiKeyMiddleware:
    def test_missing_api_key_on_collections(self, api_client):
        response = api_client.get("/api/v1/collections")
        assert response.status_code == 401
        assert "klucz" in response.json()["error"].lower()

    def test_invalid_api_key(self, api_client):
        response = api_client.get(
            "/api/v1/collections",
            HTTP_X_API_KEY="wrong-key",
        )
        assert response.status_code == 401

    @responses.activate
    def test_bearer_token_auth(self, api_client, bearer_headers):
        register_local_zotero_base(responses)
        response = api_client.get("/api/v1/collections", **bearer_headers)
        assert response.status_code == 200

    def test_health_exempt_from_api_key(self, api_client):
        response = api_client.get("/api/v1/health")
        assert response.status_code == 200

    def test_health_live_exempt_from_api_key(self, api_client):
        response = api_client.get("/api/v1/health/live")
        assert response.status_code == 200

    def test_health_zotero_requires_api_key(self, api_client):
        response = api_client.get("/api/v1/health/zotero")
        assert response.status_code == 401

    @override_settings(DEBUG=True, API_KEY="")
    @responses.activate
    def test_no_api_key_configured_in_debug(self, api_client):
        register_local_zotero_base(responses)
        response = api_client.get("/api/v1/collections")
        assert response.status_code == 200


@pytest.mark.django_db
class TestConnectorProxy:
    @responses.activate
    def test_ping_requires_api_key(self, api_client):
        register_local_zotero_base(responses)
        response = api_client.get("/connector/ping")
        assert response.status_code == 401

    @responses.activate
    def test_ping_proxies_with_api_key(self, api_client, auth_headers):
        register_local_zotero_base(responses)
        response = api_client.get("/connector/ping", **auth_headers)
        assert response.status_code == 200
        assert response["X-Zotero-Version"] == "7.0.0"
        assert response.json()["success"] is True

    @responses.activate
    def test_exec_command_proxies_not_502(self, api_client, auth_headers):
        register_exec_command(responses)
        response = api_client.post(
            "/connector/document/execCommand",
            data=json.dumps({}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert response.status_code != 502

    @responses.activate
    def test_proxy_strips_api_key_from_upstream(self, api_client, auth_headers):
        seen_headers: dict[str, str] = {}

        def request_callback(request):
            seen_headers.update(dict(request.headers))
            return (200, {"X-Zotero-Version": "7.0.0"}, json.dumps({"success": True}))

        responses.add_callback(
            responses.GET,
            "http://127.0.0.1:23119/connector/ping",
            callback=request_callback,
            content_type="application/json",
        )
        response = api_client.get("/connector/ping", **auth_headers)
        assert response.status_code == 200
        assert "X-Api-Key" not in seen_headers
        assert "X-API-Key" not in seen_headers

    @responses.activate
    def test_proxy_zotero_unavailable_returns_502(self, api_client, auth_headers):
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/connector/ping",
            body=responses.ConnectionError("connection refused"),
        )
        response = api_client.get("/connector/ping", **auth_headers)
        assert response.status_code == 502
        assert "niedostępne" in response.json()["error"].lower()
