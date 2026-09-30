"""Testy integracyjne przeciwko działającemu stackowi Docker (opcjonalne).

Uruchomienie:
  ZOTERO20_INTEGRATION=1 ZOTERO20_API_KEY=... pytest tests/integration -m integration

Wymaga: docker compose -f server/docker-compose.yml up -d
"""

from __future__ import annotations

import json
import os
import time

import pytest
import requests

pytestmark = pytest.mark.integration

BASE = os.environ.get(
    "ZOTERO_BASE",
    os.environ.get("ZOTERO20_INTEGRATION_BASE", "http://127.0.0.1:8000"),
)
TEST_DOI = os.environ.get("SMOKE_TEST_DOI", "10.1038/nature12373")
INTEGRATION_ENABLED = os.environ.get("ZOTERO20_INTEGRATION", "").lower() in (
    "1",
    "true",
    "yes",
)


def _api_key() -> str:
    return os.environ.get("ZOTERO20_API_KEY", "dev-api-key-change-me")


def _skip_unless_integration():
    if not INTEGRATION_ENABLED:
        pytest.skip("Ustaw ZOTERO20_INTEGRATION=1 aby uruchomić testy integracyjne")


def _headers() -> dict[str, str]:
    return {"X-API-Key": _api_key()}


def _wait_healthy(max_wait: int = 300) -> None:
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            response = requests.get(f"{BASE}/api/v1/health", timeout=10)
            if response.status_code == 200:
                return
        except requests.RequestException:
            pass
        time.sleep(5)
    pytest.fail(f"Stack nie odpowiada na {BASE}/api/v1/health")


@pytest.fixture(scope="module", autouse=True)
def require_integration():
    _skip_unless_integration()
    _wait_healthy()


class TestDockerStackIntegration:
    def test_health_endpoint(self):
        response = requests.get(f"{BASE}/api/v1/health", timeout=30)
        assert response.status_code in (200, 503)
        data = response.json()
        assert data["service"] == "zotero20-api"

    def test_connector_ping_with_api_key(self):
        response = requests.get(
            f"{BASE}/connector/ping",
            headers=_headers(),
            timeout=30,
        )
        assert response.status_code == 200
        assert "X-Zotero-Version" in response.headers or "running" in response.text.lower()

    def test_collections_with_api_key(self):
        response = requests.get(
            f"{BASE}/api/v1/collections",
            headers=_headers(),
            timeout=30,
        )
        assert response.status_code == 200, response.text[:500]
        data = response.json()
        assert "collections" in data
        assert "source" in data

    def test_styles_with_api_key(self):
        response = requests.get(
            f"{BASE}/api/v1/styles",
            headers=_headers(),
            timeout=30,
        )
        assert response.status_code == 200
        data = response.json()
        assert any(s["id"] == "apa" for s in data["styles"])

    def test_import_doi_bibliography_and_item_citation(self):
        coll_response = requests.get(
            f"{BASE}/api/v1/collections",
            headers=_headers(),
            timeout=30,
        )
        assert coll_response.status_code == 200
        collections = coll_response.json().get("collections") or []
        if not collections:
            pytest.skip("Brak kolekcji w Zotero — utwórz kolekcję w kontenerze")
        coll_key = collections[0]["key"]

        import_response = requests.post(
            f"{BASE}/api/v1/import/doi",
            headers={**_headers(), "Content-Type": "application/json"},
            data=json.dumps({"doi": TEST_DOI, "collection_key": coll_key}),
            timeout=120,
        )
        assert import_response.status_code == 200, import_response.text[:500]
        import_data = import_response.json()
        item_key = import_data.get("item_key") or (import_data.get("result") or {}).get("key", "")
        assert item_key or import_data.get("duplicate")

        if item_key:
            item_response = requests.get(
                f"{BASE}/api/v1/items/{item_key}?style=apa",
                headers=_headers(),
                timeout=60,
            )
            assert item_response.status_code == 200, item_response.text[:500]

            bib_response = requests.post(
                f"{BASE}/api/v1/bibliography",
                headers={**_headers(), "Content-Type": "application/json"},
                data=json.dumps({"item_keys": [item_key], "style": "apa"}),
                timeout=120,
            )
            assert bib_response.status_code == 200, bib_response.text[:500]
            assert bib_response.json().get("entries")

    def test_exec_command_not_502(self):
        response = requests.post(
            f"{BASE}/connector/document/execCommand",
            headers={**_headers(), "Content-Type": "application/json"},
            json={},
            timeout=60,
        )
        assert response.status_code != 502
        assert response.status_code != 0
