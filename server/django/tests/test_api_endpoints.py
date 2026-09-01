import json

import pytest
import responses
from django.test import override_settings

from tests.constants import COLLECTION_KEY, ITEM_KEY_1, ITEM_KEY_2, TEST_DOI
from tests.helpers.zotero_mock import (
    register_add_item_by_id,
    register_doi_search_empty,
    register_doi_search_found,
    register_full_local_api,
    register_local_zotero_base,
)


@pytest.mark.django_db
class TestHealthEndpoint:
    @responses.activate
    def test_health_no_api_key_required(self, api_client):
        register_local_zotero_base(responses)
        response = api_client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "zotero20-api"
        assert "zotero" in data

    @responses.activate
    def test_health_degraded_when_ping_fails(self, api_client):
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/connector/ping",
            status=503,
        )
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/api/plus/health",
            status=404,
        )
        response = api_client.get("/api/v1/health")
        assert response.status_code == 503
        assert response.json()["status"] == "degraded"


@pytest.mark.django_db
class TestCollectionsEndpoint:
    @responses.activate
    def test_requires_api_key(self, api_client):
        response = api_client.get("/api/v1/collections")
        assert response.status_code == 401

    @responses.activate
    def test_returns_collections(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.get("/api/v1/collections", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "local"
        assert len(data["collections"]) == 2
        keys = {c["key"] for c in data["collections"]}
        assert COLLECTION_KEY in keys

    @responses.activate
    def test_collections_upstream_error(self, api_client, auth_headers):
        register_local_zotero_base(responses)
        responses.replace(
            responses.GET,
            "http://127.0.0.1:23119/api/users/0/collections",
            status=500,
            body="internal error",
        )
        response = api_client.get("/api/v1/collections", **auth_headers)
        assert response.status_code == 502


@pytest.mark.django_db
class TestImportDoiEndpoint:
    @responses.activate
    def test_requires_doi(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/import/doi",
            data=json.dumps({"collection_key": COLLECTION_KEY}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert "doi" in response.json()["error"].lower()

    @responses.activate
    def test_requires_collection_key_or_study(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/import/doi",
            data=json.dumps({"doi": TEST_DOI}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400

    @responses.activate
    def test_invalid_doi(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/import/doi",
            data=json.dumps({"doi": "not-a-doi", "collection_key": COLLECTION_KEY}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400

    @responses.activate
    def test_import_new_item(self, api_client, auth_headers):
        register_local_zotero_base(responses)
        register_doi_search_empty(responses)
        register_add_item_by_id(responses, new_key="NEWITEM1")
        response = api_client.post(
            "/api/v1/import/doi",
            data=json.dumps({"doi": TEST_DOI, "collection_key": COLLECTION_KEY}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["doi"] == TEST_DOI
        assert data["item_key"] == "NEWITEM1"

    @responses.activate
    def test_import_duplicate_dedup(self, api_client, auth_headers):
        register_local_zotero_base(responses)
        register_doi_search_found(responses)
        response = api_client.post(
            "/api/v1/import/doi",
            data=json.dumps({"doi": TEST_DOI, "collection_key": COLLECTION_KEY}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["duplicate"] is True
        assert data["item_key"] == ITEM_KEY_1
        assert "już w kolekcji" in data["message"]

    @responses.activate
    def test_import_via_study_slug(self, api_client, auth_headers, studies_config):
        register_local_zotero_base(responses)
        register_doi_search_empty(responses)
        register_add_item_by_id(responses)
        response = api_client.post(
            "/api/v1/import/doi",
            data=json.dumps({"doi": TEST_DOI, "study": "test-study"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["study"] == "test-study"


@pytest.mark.django_db
class TestBibliographyEndpoint:
    @responses.activate
    def test_bibliography_by_collection_key(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/bibliography",
            data=json.dumps({"collection_key": COLLECTION_KEY, "style": "apa"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["collection_key"] == COLLECTION_KEY
        assert data["item_count"] == 2
        assert len(data["entries"]) == 2
        assert "Smith" in data["entries"][0]

    @responses.activate
    def test_bibliography_by_item_keys_preserves_order(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/bibliography",
            data=json.dumps(
                {"item_keys": [ITEM_KEY_2, ITEM_KEY_1], "style": "apa"}
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["item_keys"] == [ITEM_KEY_2, ITEM_KEY_1]
        assert "Kowalski" in data["entries"][0]
        assert "Smith" in data["entries"][1]

    @responses.activate
    def test_bibliography_requires_collection_or_item_keys(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/bibliography",
            data=json.dumps({"style": "apa"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400

    @responses.activate
    def test_bibliography_invalid_style(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/bibliography",
            data=json.dumps(
                {"item_keys": [ITEM_KEY_1], "style": "nonexistent-style"}
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400


@pytest.mark.django_db
class TestItemDetailEndpoint:
    @responses.activate
    def test_get_item_without_style(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.get(f"/api/v1/items/{ITEM_KEY_1}", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["item"]["key"] == ITEM_KEY_1
        assert data["item"]["doi"] == TEST_DOI

    @responses.activate
    def test_get_item_with_style_citation(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.get(
            f"/api/v1/items/{ITEM_KEY_1}?style=apa",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["citation_text"] == "(Smith, 2013)"
        assert data["style"] == "apa"

    @responses.activate
    def test_get_item_not_found(self, api_client, auth_headers):
        register_local_zotero_base(responses)
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/api/users/0/items/MISSING1",
            status=404,
        )
        response = api_client.get("/api/v1/items/MISSING1", **auth_headers)
        assert response.status_code == 404


@pytest.mark.django_db
class TestStudiesEndpoint:
    @responses.activate
    def test_studies_list(self, api_client, auth_headers, studies_config):
        register_full_local_api(responses)
        response = api_client.get("/api/v1/studies", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["studies"]) == 1
        assert data["studies"][0]["slug"] == "test-study"
        assert "zotero_collections" in data


@pytest.mark.django_db
class TestStylesEndpoint:
    def test_styles_list(self, api_client, auth_headers):
        response = api_client.get("/api/v1/styles", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "styles" in data
        assert data["default"] == "apa"


@pytest.mark.django_db
class TestCollectionItemsEndpoint:
    @responses.activate
    def test_collection_items(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.get(
            f"/api/v1/collection-items?collection_key={COLLECTION_KEY}",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["collection_key"] == COLLECTION_KEY
        assert len(data["items"]) == 2
