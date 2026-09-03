import pytest
import responses
from django.test import override_settings

from apps.imports.services.zotero_web import ZoteroWebClient, web_api_configured
from tests.constants import COLLECTION_KEY, ITEM_KEY_1, TEST_DOI
from tests.helpers.zotero_mock import register_web_api


class TestWebApiConfigured:
    @override_settings(ZOTERO_WEB_API_KEY="")
    def test_not_configured_without_key(self):
        assert web_api_configured() is False

    @override_settings(ZOTERO_WEB_API_KEY="some-key")
    def test_configured_with_key(self):
        assert web_api_configured() is True


class TestZoteroWebClient:
    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="")
    def test_resolve_user_id_from_key(self):
        register_web_api(responses)
        client = ZoteroWebClient()
        assert client.resolve_user_id() == "12345"

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_list_collections(self):
        register_web_api(responses)
        client = ZoteroWebClient()
        items = client.list_collections()
        assert len(items) == 2
        assert items[0]["key"] in {COLLECTION_KEY, "EFGH5678"}

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_add_item_creates_new(self):
        register_web_api(responses)
        responses.add(
            responses.GET,
            f"https://api.crossref.org/works/{TEST_DOI}",
            json={
                "message": {
                    "title": ["Test Article"],
                    "author": [{"family": "Smith", "given": "John"}],
                    "issued": {"date-parts": [[2013, 8, 14]]},
                }
            },
            status=200,
        )
        client = ZoteroWebClient()
        result = client.add_item_by_id(TEST_DOI, COLLECTION_KEY)
        assert result["success"] is True
        assert result["key"] == "WEBNEW01"

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_health_summary(self):
        register_web_api(responses)
        client = ZoteroWebClient()
        summary = client.health_summary()
        assert summary["api"] == "web"
        assert summary["user_id"] == "12345"
        assert summary["collections_count"] == 2

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_fetch_item_citation(self):
        register_web_api(responses)
        client = ZoteroWebClient()
        text = client.fetch_item_citation(ITEM_KEY_1, "apa")
        assert text == "(Smith, 2013)"

    @responses.activate
    @override_settings(ZOTERO_WEB_API_KEY="web-test-key", ZOTERO_WEB_USER_ID="12345")
    def test_fetch_item_citation_falls_back_to_batch_when_html_export_fails(self):
        register_web_api(responses)
        responses.replace(
            responses.GET,
            "https://api.zotero.org/users/12345/items/ITEMKEY1",
            status=502,
            body="upstream error",
            match=[
                responses.matchers.query_param_matcher(
                    {"format": "citation", "style": "apa", "locale": "pl-PL"}
                )
            ],
        )
        client = ZoteroWebClient()
        text = client.fetch_item_citation(ITEM_KEY_1, "apa")
        assert text == "(Smith, 2013)"
