import pytest
import responses
from django.test import override_settings

from apps.imports.services.cite_public import public_cite_payload
from tests.constants import ITEM_KEY_1, TEST_DOI
from tests.helpers.zotero_mock import (
    load_json,
    register_full_local_api,
    register_local_zotero_base,
    register_web_api,
)


@pytest.mark.django_db
class TestCiteLandingView:
    @responses.activate
    def test_html_200_contains_title_no_api_key(self, api_client):
        register_full_local_api(responses)
        response = api_client.get(f"/cite/{ITEM_KEY_1}")
        assert response.status_code == 200
        assert "text/html" in response["Content-Type"]
        body = response.content.decode("utf-8")
        assert "Test Article About Nature" in body
        assert "Smith, John" in body
        assert "2013" in body
        assert "Nature" in body
        assert TEST_DOI in body
        assert "https://doi.org/" + TEST_DOI in body
        assert "An abstract about nature and testing." in body
        assert ITEM_KEY_1 in body
        assert "og:title" in body
        assert "Cache-Control" in response
        assert "max-age=30" in response["Cache-Control"]
        assert "collections" not in body
        assert "ZOTERO20_API_KEY" not in body
        assert "web-test-key" not in body
        assert "Zotero-API-Key" not in body

    @responses.activate
    def test_query_params_ignored(self, api_client):
        register_full_local_api(responses)
        response = api_client.get(
            f"/cite/{ITEM_KEY_1}?c=abc123&t=Kucsko%20et%20al.,%202013"
        )
        assert response.status_code == 200
        assert "Test Article About Nature" in response.content.decode("utf-8")

    @responses.activate
    def test_json_via_query(self, api_client):
        register_full_local_api(responses)
        response = api_client.get(f"/cite/{ITEM_KEY_1}?format=json")
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Article About Nature"
        assert data["item_key"] == ITEM_KEY_1
        assert data["doi"] == TEST_DOI
        assert data["doi_url"] == f"https://doi.org/{TEST_DOI}"
        assert data["year"] == "2013"
        assert data["journal"] == "Nature"
        assert data["abstract"]
        assert "collections" not in data
        assert "creators" not in data

    @responses.activate
    def test_json_via_accept(self, api_client):
        register_full_local_api(responses)
        response = api_client.get(
            f"/cite/{ITEM_KEY_1}",
            HTTP_ACCEPT="application/json",
        )
        assert response.status_code == 200
        assert response.json()["title"] == "Test Article About Nature"

    @responses.activate
    def test_404_html(self, api_client):
        register_local_zotero_base(responses)
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/api/users/0/items/MISSING1",
            status=404,
        )
        response = api_client.get("/cite/MISSING1")
        assert response.status_code == 404
        body = response.content.decode("utf-8")
        assert "Nie znaleziono" in body
        assert "MISSING1" in body

    @responses.activate
    def test_404_json(self, api_client):
        register_local_zotero_base(responses)
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/api/users/0/items/MISSING1",
            status=404,
        )
        response = api_client.get("/cite/MISSING1?format=json")
        assert response.status_code == 404
        data = response.json()
        assert "error" in data
        assert data["item_key"] == "MISSING1"

    def test_invalid_key_404_without_zotero(self, api_client):
        response = api_client.get("/cite/bad_key?format=json")
        assert response.status_code == 404

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_web_api_includes_zotero_org_link(self, api_client):
        register_web_api(responses)
        response = api_client.get(f"/cite/{ITEM_KEY_1}?format=json")
        assert response.status_code == 200
        data = response.json()
        assert data["zotero_url"] == f"https://www.zotero.org/users/12345/items/{ITEM_KEY_1}"
        assert "web-test-key" not in response.content.decode("utf-8")


class TestPublicCitePayload:
    def test_omits_private_fields(self):
        entry = load_json("item_journal.json")
        payload = public_cite_payload(entry, library_user_id="99")
        assert payload["title"] == "Test Article About Nature"
        assert payload["authors"] == "Smith, John"
        assert payload["year"] == "2013"
        assert payload["journal"] == "Nature"
        assert payload["doi"] == TEST_DOI
        assert "collections" not in payload
        assert "notes" not in payload
        assert "extra" not in payload
        assert payload["zotero_url"] == "https://www.zotero.org/users/99/items/ITEMKEY1"

    def test_skips_zotero_link_for_local_user_zero(self):
        payload = public_cite_payload(
            {"key": "ABC", "data": {"title": "X"}},
            library_user_id="0",
        )
        assert payload["zotero_url"] == ""
