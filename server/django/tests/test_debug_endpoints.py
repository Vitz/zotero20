import json

import pytest
import responses

from tests.constants import COLLECTION_KEY, ITEM_KEY_1, ITEM_KEY_2
from tests.helpers.zotero_mock import register_full_local_api, register_local_zotero_base


@pytest.mark.django_db
class TestDebugEndpoints:
    def test_debug_echo_requires_auth(self, api_client):
        response = api_client.post(
            "/api/v1/debug/echo",
            data=json.dumps({"ping": True}),
            content_type="application/json",
        )
        assert response.status_code == 401

    def test_debug_echo(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/debug/echo",
            data=json.dumps({"ping": True, "n": 1}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["body"]["ping"] is True
        assert data["headers"]["x-api-key"] == "present"

    @responses.activate
    def test_debug_health_verbose(self, api_client, auth_headers):
        register_local_zotero_base(responses)
        response = api_client.get("/api/v1/debug/health", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["endpoint"] == "debug/health"
        assert data.get("verbose") is True
        assert "styles_count" in data

    @responses.activate
    def test_health_verbose_query(self, api_client):
        register_local_zotero_base(responses)
        response = api_client.get("/api/v1/health?verbose=1")
        assert response.status_code == 200
        assert response.json().get("verbose") is True

    def test_debug_styles(self, api_client, auth_headers):
        response = api_client.get("/api/v1/debug/styles", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["endpoint"] == "debug/styles"
        assert len(data["styles"]) >= 1

    @responses.activate
    def test_debug_item(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.get(
            f"/api/v1/debug/item/{ITEM_KEY_1}?style=apa",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["item_key"] == ITEM_KEY_1
        assert data["item"]["key"] == ITEM_KEY_1
        assert isinstance(data["citation_trace"], list)
        assert data["style"] == "apa"

    @responses.activate
    def test_debug_citations_trace(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/debug/citations",
            data=json.dumps({"item_keys": [ITEM_KEY_2, ITEM_KEY_1], "style": "ieee"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["numeric"] is True
        assert data["code_path"] == "numeric_renumber"
        assert isinstance(data["trace"], list)
        assert len(data["citations"]) == 2

    @responses.activate
    def test_collection_items_dedupes_doi(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.get(
            f"/api/v1/collection-items?collection_key={COLLECTION_KEY}&limit=20",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
