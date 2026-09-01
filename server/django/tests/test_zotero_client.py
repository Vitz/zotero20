import pytest
import responses

from apps.imports.middleware import normalize_doi, normalize_orcid
from apps.imports.services.exceptions import ZoteroClientError
from apps.imports.services.zotero import ZoteroClient
from tests.constants import COLLECTION_KEY, ITEM_KEY_1, TEST_DOI
from tests.helpers.zotero_mock import (
    register_add_item_by_id,
    register_doi_search_empty,
    register_doi_search_found,
    register_full_local_api,
    register_local_zotero_base,
)


class TestNormalizeHelpers:
    def test_normalize_doi_variants(self):
        assert normalize_doi("10.1038/nature12373") == "10.1038/nature12373"
        assert normalize_doi("https://doi.org/10.1038/nature12373") == "10.1038/nature12373"
        assert normalize_doi("doi:10.1038/nature12373") == "10.1038/nature12373"
        assert normalize_doi("invalid") is None

    def test_normalize_orcid(self):
        assert normalize_orcid("0000-0002-1825-0097") == "0000-0002-1825-0097"
        assert normalize_orcid("https://orcid.org/0000-0002-1825-0097") == "0000-0002-1825-0097"
        assert normalize_orcid("bad") is None


class TestZoteroClient:
    @responses.activate
    def test_ping(self):
        register_local_zotero_base(responses)
        client = ZoteroClient()
        data = client.ping()
        assert data["success"] is True

    @responses.activate
    def test_ping_failure_raises(self):
        responses.add(
            responses.GET,
            "http://127.0.0.1:23119/connector/ping",
            status=503,
        )
        client = ZoteroClient()
        with pytest.raises(ZoteroClientError):
            client.ping()

    @responses.activate
    def test_list_collections_sorted(self):
        register_local_zotero_base(responses)
        client = ZoteroClient()
        items = client.list_collections()
        assert len(items) == 2
        names = [i["name"] for i in items]
        assert names == sorted(names, key=str.lower)

    @responses.activate
    def test_find_item_by_doi(self):
        register_local_zotero_base(responses)
        register_doi_search_found(responses)
        client = ZoteroClient()
        item = client.find_item_by_doi(TEST_DOI)
        assert item is not None
        assert item["key"] == ITEM_KEY_1

    @responses.activate
    def test_find_item_in_collection_by_doi(self):
        register_local_zotero_base(responses)
        register_doi_search_found(responses)
        client = ZoteroClient()
        assert client.find_item_in_collection_by_doi(TEST_DOI, COLLECTION_KEY) is not None
        assert client.find_item_in_collection_by_doi(TEST_DOI, "WRONGKEY") is None

    @responses.activate
    def test_add_item_duplicate(self):
        register_local_zotero_base(responses)
        register_doi_search_found(responses)
        client = ZoteroClient()
        result = client.add_item_by_id(TEST_DOI, COLLECTION_KEY)
        assert result["duplicate"] is True
        assert result["key"] == ITEM_KEY_1

    @responses.activate
    def test_add_item_new_via_api_plus(self):
        register_local_zotero_base(responses)
        register_doi_search_empty(responses)
        register_add_item_by_id(responses, new_key="NEWKEY99")
        client = ZoteroClient()
        result = client.add_item_by_id(TEST_DOI, COLLECTION_KEY)
        assert result["key"] == "NEWKEY99"

    @responses.activate
    def test_health_summary(self):
        register_full_local_api(responses)
        client = ZoteroClient()
        summary = client.health_summary()
        assert summary["ping"] is not None
        assert summary["api_plus"] is not None

    @responses.activate
    def test_fetch_item_citation(self):
        register_full_local_api(responses)
        client = ZoteroClient()
        text = client.fetch_item_citation(ITEM_KEY_1, "apa")
        assert text == "(Smith, 2013)"

    @responses.activate
    def test_get_item(self):
        register_full_local_api(responses)
        client = ZoteroClient()
        item = client.get_item(ITEM_KEY_1)
        assert item["title"] == "Test Article About Nature"
