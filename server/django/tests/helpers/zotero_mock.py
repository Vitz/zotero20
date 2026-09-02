"""Mock lokalnego Zotero (port 23119) i Web API dla testów pytest."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import responses

from tests.constants import COLLECTION_KEY, ITEM_KEY_1, ITEM_KEY_2, TEST_DOI

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "zotero"
DEFAULT_BASE = "http://127.0.0.1:23119"


def load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def load_json(name: str) -> Any:
    return json.loads(load_fixture(name))


def _no_format_param(request) -> tuple[bool, str]:
    ok = "format=" not in request.url
    return ok, "" if ok else "format query param present"


def _batch_include_param(request) -> tuple[bool, str]:
    ok = "include=bib" in request.url
    return ok, "" if ok else "not a batch include=bib request"


# Surowe wpisy bibliografii tak, jak zwraca je Zotero: każda pozycja pobrana osobno
# dostaje w stylach numerycznych numer [1], stąd konieczność przenumerowania na serwerze.
_BATCH_ITEMS = {
    ITEM_KEY_1: ("Smith, J. (2013). Test Article About Nature.", "(Smith, 2013)"),
    ITEM_KEY_2: ("Kowalski, A. (2020). Second Test Article.", "(Kowalski, 2020)"),
}
_NUMERIC_STYLES = ("ieee", "vancouver")


def register_zotero_mocks(
    rsps: responses.RequestsMock | None = None,
    *,
    collection_key: str = COLLECTION_KEY,
    item_key_1: str = ITEM_KEY_1,
    item_key_2: str = ITEM_KEY_2,
    test_doi: str = TEST_DOI,
    base_url: str = DEFAULT_BASE,
) -> None:
    """Rejestruje typowe odpowiedzi Zotero Local API (używane przez fixture mock_zotero)."""
    if rsps is None:
        rsps = responses
    register_local_zotero_base(rsps, base_url)
    register_collection_items(rsps, collection_key, base_url)
    register_item_citation(rsps, item_key_1, base_url)
    register_item_bibliography(rsps, item_key_1, "bib_item1.html", base_url)
    register_item_bibliography(rsps, item_key_2, "bib_item2.html", base_url)
    register_collection_bibliography(rsps, collection_key, base_url)
    register_item_detail(rsps, item_key_1, base_url)
    register_item_detail(rsps, item_key_2, base_url)
    register_items_batch_formatted(rsps, f"{base_url}/api/users/0/items")
    register_doi_search_empty(rsps, base_url)
    register_add_item_by_id(rsps, new_key="NEWITEM1", base_url=base_url)
    register_exec_command(rsps, base_url)


def register_local_zotero_base(
    rsps: responses.RequestsMock,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.GET,
        f"{base_url}/connector/ping",
        json=load_json("ping.json"),
        status=200,
        headers={"X-Zotero-Version": "7.0.0"},
    )
    rsps.add(
        responses.GET,
        f"{base_url}/api/plus/health",
        json=load_json("api_plus_health.json"),
        status=200,
    )
    rsps.add(
        responses.GET,
        f"{base_url}/api/users/0/collections",
        json=load_json("collections.json"),
        status=200,
    )


def register_collection_items(
    rsps: responses.RequestsMock,
    collection_key: str = COLLECTION_KEY,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.GET,
        re.compile(
            rf"{re.escape(base_url)}/api/users/0/collections/{collection_key}/items/top"
        ),
        json=load_json("collection_items.json"),
        status=200,
        match=[_no_format_param],
    )


def register_item_detail(
    rsps: responses.RequestsMock,
    item_key: str,
    base_url: str = DEFAULT_BASE,
) -> None:
    fixture = "item_journal.json" if item_key == ITEM_KEY_1 else "item_second.json"
    rsps.add(
        responses.GET,
        f"{base_url}/api/users/0/items/{item_key}",
        json=load_json(fixture),
        status=200,
        match=[_no_format_param],
    )


def register_item_citation(
    rsps: responses.RequestsMock,
    item_key: str,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.GET,
        f"{base_url}/api/users/0/items/{item_key}",
        body=load_fixture("citation_item1.html"),
        status=200,
        content_type="text/html",
        match=[
            responses.matchers.query_param_matcher(
                {"format": "citation", "style": "apa", "locale": "pl-PL"}
            )
        ],
    )


def register_item_bibliography(
    rsps: responses.RequestsMock,
    item_key: str,
    html_fixture: str,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.GET,
        f"{base_url}/api/users/0/items/{item_key}",
        body=load_fixture(html_fixture),
        status=200,
        content_type="text/html",
        match=[
            responses.matchers.query_param_matcher(
                {"format": "bib", "style": "apa", "locale": "pl-PL"}
            )
        ],
    )


def register_collection_bibliography(
    rsps: responses.RequestsMock,
    collection_key: str = COLLECTION_KEY,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.GET,
        f"{base_url}/api/users/0/collections/{collection_key}/items/top",
        body=load_fixture("bib_collection.html"),
        status=200,
        content_type="text/html",
        match=[
            responses.matchers.query_param_matcher(
                {"format": "bib", "style": "apa", "locale": "pl-PL"}
            )
        ],
    )


def register_items_batch_formatted(
    rsps: responses.RequestsMock,
    items_url: str,
) -> None:
    """Symuluje GET …/items?itemKey=…&format=json&include=bib,citation."""

    def callback(request):
        query = parse_qs(urlparse(request.url).query)
        keys = [key for key in (query.get("itemKey", [""])[0]).split(",") if key]
        style = (query.get("style", ["apa"])[0] or "apa").lower()
        numeric = style in _NUMERIC_STYLES
        payload = []
        for index, key in enumerate(keys, start=1):
            if key not in _BATCH_ITEMS:
                continue
            entry, citation = _BATCH_ITEMS[key]
            bib_entry = f"[1] {entry}" if numeric else entry
            citation_text = "[1]" if numeric else citation
            payload.append(
                {
                    "key": key,
                    "bib": f'<div class="csl-bib-body"><div class="csl-entry">'
                    f"{bib_entry}</div></div>",
                    "citation": f'<span class="citation">{citation_text}</span>',
                }
            )
        return 200, {"Content-Type": "application/json"}, json.dumps(payload)

    rsps.add_callback(
        responses.GET,
        re.compile(rf"{re.escape(items_url)}\?.*"),
        callback=callback,
        match=[_batch_include_param],
        content_type="application/json",
    )


def register_doi_search_empty(
    rsps: responses.RequestsMock,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.GET,
        re.compile(rf"{re.escape(base_url)}/api/users/0/items\?.*"),
        json=load_json("items_search_empty.json"),
        status=200,
    )


def register_doi_search_found(
    rsps: responses.RequestsMock,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.GET,
        re.compile(rf"{re.escape(base_url)}/api/users/0/items\?.*"),
        json=load_json("items_search_doi.json"),
        status=200,
    )


def register_add_item_by_id(
    rsps: responses.RequestsMock,
    new_key: str = "NEWITEM1",
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.POST,
        f"{base_url}/api/plus/add-item-by-id",
        json={"success": True, "key": new_key, "itemKey": new_key},
        status=201,
    )


def register_exec_command(
    rsps: responses.RequestsMock,
    base_url: str = DEFAULT_BASE,
) -> None:
    rsps.add(
        responses.POST,
        f"{base_url}/connector/document/execCommand",
        json=load_json("exec_command_error.json"),
        status=400,
        headers={"X-Zotero-Version": "7.0.0"},
    )


def register_full_local_api(
    rsps: responses.RequestsMock,
    base_url: str = DEFAULT_BASE,
) -> None:
    register_zotero_mocks(rsps, base_url=base_url)


def register_web_api(
    rsps: responses.RequestsMock,
    user_id: str = "12345",
    api_key: str = "web-test-key",
) -> None:
    base = "https://api.zotero.org"
    rsps.add(
        responses.GET,
        f"{base}/keys/{api_key}",
        json={"userID": int(user_id), "username": "testuser"},
        status=200,
    )
    rsps.add(
        responses.GET,
        f"{base}/users/{user_id}/collections",
        json=load_json("collections.json"),
        status=200,
    )
    register_items_batch_formatted(rsps, f"{base}/users/{user_id}/items")
    rsps.add(
        responses.GET,
        re.compile(rf"{re.escape(base)}/users/{user_id}/items\?.*"),
        json=load_json("items_search_empty.json"),
        status=200,
    )
    rsps.add(
        responses.GET,
        re.compile(
            rf"{re.escape(base)}/users/{user_id}/collections/{COLLECTION_KEY}/items/top"
        ),
        json=load_json("collection_items.json"),
        status=200,
        match=[_no_format_param],
    )
    rsps.add(
        responses.GET,
        f"{base}/users/{user_id}/items/{ITEM_KEY_1}",
        json=load_json("item_journal.json"),
        status=200,
        match=[_no_format_param],
    )
    rsps.add(
        responses.GET,
        f"{base}/users/{user_id}/items/{ITEM_KEY_1}",
        body=load_fixture("citation_item1.html"),
        status=200,
        content_type="text/html",
        match=[
            responses.matchers.query_param_matcher(
                {"format": "citation", "style": "apa", "locale": "pl-PL"}
            )
        ],
    )
    rsps.add(
        responses.GET,
        f"{base}/users/{user_id}/items/{ITEM_KEY_1}",
        body=load_fixture("bib_item1.html"),
        status=200,
        content_type="text/html",
        match=[
            responses.matchers.query_param_matcher(
                {"format": "bib", "style": "apa", "locale": "pl-PL"}
            )
        ],
    )
    rsps.add(
        responses.GET,
        f"{base}/users/{user_id}/collections/{COLLECTION_KEY}/items/top",
        body=load_fixture("bib_collection.html"),
        status=200,
        content_type="text/html",
        match=[
            responses.matchers.query_param_matcher(
                {"format": "bib", "style": "apa", "locale": "pl-PL"}
            )
        ],
    )
    rsps.add(
        responses.POST,
        f"{base}/users/{user_id}/items",
        json={
            "successful": {"0": {"key": "WEBNEW01", "version": 1}},
            "failed": {},
        },
        status=200,
    )
