"""Wspólne fixture'y pytest dla Django + symulacja Zotero."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key-for-pytest")
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault("ZOTERO_URL", "http://127.0.0.1:23119")
# Unit testy — nie nadpisuj klucza gdy uruchamiane są testy integracyjne (ZOTERO20_INTEGRATION=1).
if os.environ.get("ZOTERO20_INTEGRATION", "").lower() not in ("1", "true", "yes"):
    os.environ["ZOTERO20_API_KEY"] = "test-api-key"
# Wymuś lokalny klient Zotero (bez Web API) — testy mockują :23119.
os.environ["ZOTERO_WEB_API_KEY"] = ""

from tests.constants import COLLECTION_KEY


@pytest.fixture(autouse=True)
def configure_test_settings(settings):
    if os.environ.get("ZOTERO20_INTEGRATION", "").lower() not in ("1", "true", "yes"):
        settings.API_KEY = "test-api-key"
        settings.DEBUG = True
    settings.ZOTERO_WEB_API_KEY = ""


@pytest.fixture
def api_key() -> str:
    return os.environ["ZOTERO20_API_KEY"]


@pytest.fixture
def api_client():
    from django.test import Client

    return Client()


@pytest.fixture
def auth_headers(api_key: str) -> dict[str, str]:
    return {"HTTP_X_API_KEY": api_key}


@pytest.fixture
def bearer_headers(api_key: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {api_key}"}


@pytest.fixture
def mock_zotero():
    """Mock HTTP Zotero Local API (:23119) — wymaga responses."""
    import responses as responses_lib

    from tests.helpers.zotero_mock import register_zotero_mocks

    with responses_lib.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        register_zotero_mocks(rsps)
        yield rsps


@pytest.fixture
def studies_config(tmp_path, settings):
    """Tymczasowy studies.yaml z jednym badaniem testowym."""
    path = tmp_path / "studies.yaml"
    path.write_text(
        f"""studies:
  test-study:
    label: "Test Study"
    collection_key: "{COLLECTION_KEY}"
""",
        encoding="utf-8",
    )
    settings.STUDIES_CONFIG = str(path)
    return path
