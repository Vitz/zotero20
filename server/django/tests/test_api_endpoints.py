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
    register_remove_from_collection,
)


@pytest.mark.django_db
class TestHealthEndpoint:
    def test_health_no_api_key_required(self, api_client):
        response = api_client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "zotero20-api"
        assert "build" in data
        assert "zotero" not in data

    def test_health_live_alias(self, api_client):
        response = api_client.get("/api/v1/health/live")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "build" in data


@pytest.mark.django_db
class TestHealthZoteroEndpoint:
    def test_requires_api_key(self, api_client):
        response = api_client.get("/api/v1/health/zotero")
        assert response.status_code == 401

    @responses.activate
    def test_ok_local(self, api_client, auth_headers):
        register_local_zotero_base(responses)
        response = api_client.get("/api/v1/health/zotero", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["zotero"]["api"] == "local"
        assert data["zotero"]["reachable"] is True

    @responses.activate
    def test_error_when_ping_fails(self, api_client, auth_headers):
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/connector/ping",
            status=503,
        )
        response = api_client.get("/api/v1/health/zotero", **auth_headers)
        assert response.status_code == 503
        data = response.json()
        assert data["status"] == "error"
        assert data["zotero"]["reachable"] is False
        assert data["zotero"].get("error")

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_ok_web(self, api_client, auth_headers):
        from tests.helpers.zotero_mock import register_web_api

        register_web_api(responses)
        response = api_client.get("/api/v1/health/zotero", **auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["zotero"]["api"] == "web"
        assert data["zotero"]["reachable"] is True
        assert data["zotero"]["user_id"] == "12345"


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

    @responses.activate
    def test_create_collection_requires_name(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/collections",
            data=json.dumps({}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert "name" in response.json()["error"].lower()

    @responses.activate
    def test_create_collection_empty_name(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/collections",
            data=json.dumps({"name": "   "}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400

    @responses.activate
    def test_create_collection_local(self, api_client, auth_headers):
        from tests.helpers.zotero_mock import register_create_collection

        register_local_zotero_base(responses)
        register_create_collection(responses, new_key="NEWCOLL1")
        response = api_client.post(
            "/api/v1/collections",
            data=json.dumps({"name": "Nowa kolekcja"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "NEWCOLL1"
        assert data["name"] == "Nowa kolekcja"
        assert data["source"] == "local"

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_create_collection_web(self, api_client, auth_headers):
        from tests.helpers.zotero_mock import register_web_api

        register_web_api(responses)
        response = api_client.post(
            "/api/v1/collections",
            data=json.dumps({"name": "Web Collection"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "WEBCOLL1"
        assert data["name"] == "Web Collection"
        assert data["source"] == "web"


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
    def test_bibliography_empty_item_keys_never_falls_back_to_collection(
        self, api_client, auth_headers
    ):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/bibliography",
            data=json.dumps({"item_keys": [], "collection_key": COLLECTION_KEY, "style": "apa"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert "item_keys" in response.json()["error"]

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
class TestCitationsEndpoint:
    @responses.activate
    def test_returns_citations_and_bibliography_in_one_call(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps({"item_keys": [ITEM_KEY_2, ITEM_KEY_1], "style": "apa"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["style"] == "apa"
        assert data["numeric"] is False
        assert [c["item_key"] for c in data["citations"]] == [ITEM_KEY_2, ITEM_KEY_1]
        assert data["citations"][0]["citation_text"] == "(Kowalski, 2020)"
        assert data["entries"][0].startswith("Kowalski")
        assert data["entries"][1].startswith("Smith")
        assert data["locale"] == "en-US"

    @responses.activate
    def test_forwards_locale_to_zotero(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps(
                {
                    "item_keys": [ITEM_KEY_1],
                    "style": "apa",
                    "locale": "pl-PL",
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["locale"] == "pl-PL"
        formatted_urls = [
            call.request.url
            for call in responses.calls
            if "include=bib" in call.request.url or "include=bib%2Ccitation" in call.request.url
        ]
        assert formatted_urls
        assert "locale=pl-PL" in formatted_urls[0]

    @responses.activate
    def test_rejects_unknown_locale(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps(
                {"item_keys": [ITEM_KEY_1], "style": "apa", "locale": "de-DE"}
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert "język" in response.json()["error"].lower()

    @responses.activate
    def test_numeric_style_keeps_citations_and_entries_consistent(
        self, api_client, auth_headers
    ):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps({"item_keys": [ITEM_KEY_2, ITEM_KEY_1], "style": "ieee"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["numeric"] is True
        assert [c["citation_text"] for c in data["citations"]] == ["[1]", "[2]"]
        assert data["entries"][0].startswith("[1] Kowalski")
        assert data["entries"][1].startswith("[2] Smith")

    @responses.activate
    def test_duplicate_keys_are_deduplicated(self, api_client, auth_headers):
        register_full_local_api(responses)
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps(
                {"item_keys": [ITEM_KEY_1, ITEM_KEY_2, ITEM_KEY_1], "style": "ieee"}
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["item_keys"] == [ITEM_KEY_1, ITEM_KEY_2]
        assert data["item_count"] == 2

    @responses.activate
    def test_requires_item_keys(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps({"style": "apa"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400

    @responses.activate
    def test_rejects_too_many_item_keys(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps({"item_keys": [f"KEY{i:05d}" for i in range(151)], "style": "apa"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400

    def test_requires_auth(self, api_client):
        response = api_client.post(
            "/api/v1/citations",
            data=json.dumps({"item_keys": [ITEM_KEY_1], "style": "apa"}),
            content_type="application/json",
        )
        assert response.status_code == 401


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
        assert data["locale"] == "en-US"
        citation_urls = [
            call.request.url
            for call in responses.calls
            if "format=citation" in call.request.url
        ]
        assert citation_urls
        assert "locale=en-US" in citation_urls[0]

    @responses.activate
    def test_get_item_citation_with_polish_locale(self, api_client, auth_headers):
        from tests.helpers.zotero_mock import register_item_citation, register_local_zotero_base

        register_local_zotero_base(responses)
        register_item_citation(responses, ITEM_KEY_1, locale="pl-PL")
        response = api_client.get(
            f"/api/v1/items/{ITEM_KEY_1}?style=apa&locale=pl-PL",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["locale"] == "pl-PL"
        assert data["citation_text"] == "(Smith, 2013)"
        citation_urls = [
            call.request.url
            for call in responses.calls
            if "format=citation" in call.request.url
        ]
        assert citation_urls
        assert "locale=pl-PL" in citation_urls[0]

    @responses.activate
    def test_get_item_citation_rejects_unknown_locale(self, api_client, auth_headers):
        response = api_client.get(
            f"/api/v1/items/{ITEM_KEY_1}?style=apa&locale=xx-YY",
            **auth_headers,
        )
        assert response.status_code == 400

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
        assert data["items"][0]["journal_abbrev"] == "Nature"
        assert data["items"][0]["orcid"] == "0000-0002-1825-0097"
        assert data["items"][1]["journal_abbrev"] == ""
        assert data["items"][1]["orcid"] == ""


@pytest.mark.django_db
class TestCollectionItemRemoveEndpoint:
    @responses.activate
    def test_remove_item_from_collection(self, api_client, auth_headers):
        register_full_local_api(responses)
        register_remove_from_collection(responses, ITEM_KEY_1)
        response = api_client.delete(
            f"/api/v1/collections/{COLLECTION_KEY}/items/{ITEM_KEY_1}",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["removed"] is True
        assert data["item_key"] == ITEM_KEY_1
        assert data["collection_key"] == COLLECTION_KEY
        assert data["source"] == "local"

    @responses.activate
    def test_remove_missing_item(self, api_client, auth_headers):
        register_full_local_api(responses)
        responses.add(
            responses.GET,
            f"http://127.0.0.1:23119/api/users/0/items/MISSING1",
            json={"error": "not found"},
            status=404,
        )
        response = api_client.delete(
            f"/api/v1/collections/{COLLECTION_KEY}/items/MISSING1",
            **auth_headers,
        )
        assert response.status_code == 404


@pytest.mark.django_db
class TestImportManualEndpoint:
    @responses.activate
    def test_requires_title(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/import/manual",
            data=json.dumps(
                {
                    "itemType": "preprint",
                    "collection_key": COLLECTION_KEY,
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert "title" in response.json()["error"].lower()

    @responses.activate
    def test_rejects_unknown_item_type(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/import/manual",
            data=json.dumps(
                {
                    "itemType": "podcast",
                    "title": "X",
                    "collection_key": COLLECTION_KEY,
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert "itemtype" in response.json()["error"].lower()

    @responses.activate
    def test_rejects_unknown_fields(self, api_client, auth_headers):
        response = api_client.post(
            "/api/v1/import/manual",
            data=json.dumps(
                {
                    "itemType": "book",
                    "title": "Książka",
                    "weirdField": "nope",
                    "collection_key": COLLECTION_KEY,
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400
        assert "weirdfield" in response.json()["error"].lower()

    @responses.activate
    def test_creates_preprint_local(self, api_client, auth_headers):
        from tests.helpers.zotero_mock import register_create_item, register_local_zotero_base

        register_local_zotero_base(responses)
        register_create_item(responses, new_key="MANUAL01")
        response = api_client.post(
            "/api/v1/import/manual",
            data=json.dumps(
                {
                    "itemType": "preprint",
                    "title": "Draft paper",
                    "creators": [
                        {"creatorType": "author", "firstName": "Jan", "lastName": "Kowalski"}
                    ],
                    "date": "2024",
                    "url": "https://example.com/p",
                    "collection_key": COLLECTION_KEY,
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["item_key"] == "MANUAL01"
        assert data["itemType"] == "preprint"
        assert data["title"] == "Draft paper"
        assert data["source"] == "local"
        # Sprawdź, że do Local API poszło POST z kolekcją w ścieżce.
        posts = [c for c in responses.calls if c.request.method == "POST"]
        assert posts
        body = json.loads(posts[-1].request.body)
        assert body[0]["itemType"] == "preprint"
        assert body[0]["title"] == "Draft paper"
        assert "collections" not in body[0]

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_creates_book_web(self, api_client, auth_headers):
        from tests.helpers.zotero_mock import register_web_api

        register_web_api(responses)
        response = api_client.post(
            "/api/v1/import/manual",
            data=json.dumps(
                {
                    "itemType": "book",
                    "title": "Historia X",
                    "publisher": "PWN",
                    "collection_key": COLLECTION_KEY,
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["item_key"] == "WEBNEW01"
        assert data["source"] == "web"


@pytest.mark.django_db
class TestImportDescribeEndpoint:
    def test_503_without_gemini_key(self, api_client, auth_headers, settings):
        settings.GEMINI_API_KEY = ""
        response = api_client.post(
            "/api/v1/import/describe",
            data=json.dumps({"item_type": "book", "text": "Tytuł: Foo"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 503
        err = response.json()["error"].lower()
        assert "gemini" in err
        assert "ustawieniach" in err

    @responses.activate
    def test_describe_with_body_gemini_key(self, api_client, auth_headers, settings):
        """Klucz w body.gemini_api_key działa bez env i bez nagłówka (fallback sidebara)."""
        settings.GEMINI_API_KEY = ""
        settings.GEMINI_MODEL = "gemini-3.5-flash-lite"
        gemini_body = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "itemType": "book",
                                        "title": "Z body",
                                        "creators": [],
                                        "publisher": "",
                                        "date": "",
                                        "DOI": "",
                                        "ISBN": "",
                                        "url": "",
                                    }
                                )
                            }
                        ]
                    }
                }
            ]
        }
        responses.add(
            responses.POST,
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-3.5-flash-lite:generateContent",
            json=gemini_body,
            status=200,
        )
        response = api_client.post(
            "/api/v1/import/describe",
            data=json.dumps(
                {
                    "item_type": "book",
                    "text": "Tytuł: Z body",
                    "gemini_api_key": "body-gemini-key",
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["draft"]["title"] == "Z body"
        assert "body-gemini-key" in (responses.calls[0].request.url or "")

    def test_requires_item_type(self, api_client, auth_headers, settings):
        settings.GEMINI_API_KEY = "test-gemini-key"
        response = api_client.post(
            "/api/v1/import/describe",
            data=json.dumps({"text": "coś"}),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 400

    @responses.activate
    def test_describe_with_request_header_key(self, api_client, auth_headers, settings):
        """Klucz z X-Gemini-Api-Key działa bez GEMINI_API_KEY w env."""
        settings.GEMINI_API_KEY = ""
        settings.GEMINI_MODEL = "gemini-3.5-flash-lite"
        gemini_body = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "itemType": "book",
                                        "title": "Z nagłówka",
                                        "creators": [],
                                        "publisher": "",
                                        "date": "",
                                        "DOI": "",
                                        "ISBN": "",
                                        "url": "",
                                    }
                                )
                            }
                        ]
                    }
                }
            ]
        }
        responses.add(
            responses.POST,
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-3.5-flash-lite:generateContent",
            json=gemini_body,
            status=200,
        )
        headers = {**auth_headers, "HTTP_X_GEMINI_API_KEY": "sidebar-gemini-key"}
        response = api_client.post(
            "/api/v1/import/describe",
            data=json.dumps(
                {
                    "item_type": "book",
                    "text": "Tytuł: Z nagłówka",
                }
            ),
            content_type="application/json",
            **headers,
        )
        assert response.status_code == 200
        assert response.json()["draft"]["title"] == "Z nagłówka"
        assert responses.calls
        # Klucz z nagłówka trafia do Gemini jako query param — nie logujemy go.
        assert "sidebar-gemini-key" in (responses.calls[0].request.url or "")

    @responses.activate
    def test_describe_mocked_gemini(self, api_client, auth_headers, settings):
        settings.GEMINI_API_KEY = "test-gemini-key"
        settings.GEMINI_MODEL = "gemini-3.5-flash-lite"
        gemini_body = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "itemType": "book",
                                        "title": "Historia X",
                                        "creators": [
                                            {
                                                "creatorType": "author",
                                                "firstName": "Anna",
                                                "lastName": "Nowak",
                                            }
                                        ],
                                        "publisher": "PWN",
                                        "date": "2020",
                                        "DOI": "",
                                        "ISBN": "",
                                        "url": "",
                                    }
                                )
                            }
                        ]
                    }
                }
            ]
        }
        responses.add(
            responses.POST,
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-3.5-flash-lite:generateContent",
            json=gemini_body,
            status=200,
        )
        response = api_client.post(
            "/api/v1/import/describe",
            data=json.dumps(
                {
                    "item_type": "book",
                    "text": "Anna Nowak, Historia X, PWN 2020",
                }
            ),
            content_type="application/json",
            **auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["draft"]["itemType"] == "book"
        assert data["draft"]["title"] == "Historia X"
        assert "collections" not in data["draft"]
        assert data["model"] == "gemini-3.5-flash-lite"

    @responses.activate
    def test_health_verbose_gemini_flag(self, api_client, settings):
        settings.GEMINI_API_KEY = "x"
        register_local_zotero_base(responses)
        response = api_client.get("/api/v1/health?verbose=1")
        assert response.status_code == 200
        assert response.json().get("gemini_configured") is True

        settings.GEMINI_API_KEY = ""
        response = api_client.get("/api/v1/health?verbose=1")
        assert response.json().get("gemini_configured") is False
