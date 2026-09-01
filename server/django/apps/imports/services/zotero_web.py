from __future__ import annotations

import logging

import requests
from django.conf import settings

from .doi import fetch_crossref_metadata
from .citation import format_citation_text
from .exceptions import ZoteroClientError

logger = logging.getLogger(__name__)

ZOTERO_WEB_API_BASE = "https://api.zotero.org"


def web_api_configured() -> bool:
    return bool(get_web_api_key())


def get_web_api_key() -> str:
    return getattr(settings, "ZOTERO_WEB_API_KEY", "") or ""


class ZoteroWebClient:
    """Klient Zotero Web API (zotero.org) — kolekcje i import bez lokalnego Zotero."""

    def __init__(self, api_key: str | None = None, user_id: str | None = None):
        self.api_key = (api_key or get_web_api_key()).strip()
        if not self.api_key:
            raise ZoteroClientError("Brak ZOTERO_WEB_API_KEY.")
        self._user_id = (user_id or getattr(settings, "ZOTERO_WEB_USER_ID", "") or "").strip()
        self.timeout = 60
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Zotero-API-Key": self.api_key,
                "Content-Type": "application/json",
            }
        )

    def resolve_user_id(self) -> str:
        if self._user_id:
            return self._user_id

        response = self._session.get(
            f"{ZOTERO_WEB_API_BASE}/keys/{self.api_key}",
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise ZoteroClientError(
                f"Nie udało się rozwiązać userID z klucza API: HTTP {response.status_code} — "
                f"{response.text[:300]}",
                response.status_code,
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ZoteroClientError(
                f"Nieprawidłowa odpowiedź /keys: {response.text[:200]}",
                response.status_code,
            ) from exc

        user_id = str(payload.get("userID", "") or "").strip()
        if not user_id:
            raise ZoteroClientError(
                "Klucz API nie zwrócił userID — ustaw ZOTERO_WEB_USER_ID w .env.",
                response.status_code,
            )
        self._user_id = user_id
        logger.info("Rozwiązano Zotero userID=%s z klucza API", user_id)
        return self._user_id

    def list_collections(self) -> list[dict]:
        user_id = self.resolve_user_id()
        response = self._session.get(
            f"{ZOTERO_WEB_API_BASE}/users/{user_id}/collections",
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise ZoteroClientError(
                f"Web API list collections failed: HTTP {response.status_code} — "
                f"{response.text[:500]}",
                response.status_code,
            )
        try:
            raw = response.json()
        except ValueError as exc:
            raise ZoteroClientError(
                f"list collections: invalid JSON — {response.text[:200]}",
                response.status_code,
            ) from exc

        if not isinstance(raw, list):
            raise ZoteroClientError(
                f"list collections: expected JSON array, got {type(raw).__name__}",
                response.status_code,
            )

        items = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            key = entry.get("key", "")
            data = entry.get("data") or {}
            name = data.get("name", "") if isinstance(data, dict) else ""
            if key:
                items.append({"key": key, "name": name})
        items.sort(key=lambda item: (item["name"] or item["key"]).lower())
        return items

    def find_item_by_doi(self, doi: str) -> dict | None:
        """Szuka pozycji w bibliotece po DOI (Web API q=)."""
        doi = doi.strip()
        user_id = self.resolve_user_id()
        response = self._session.get(
            f"{ZOTERO_WEB_API_BASE}/users/{user_id}/items",
            params={"q": f'doi:"{doi}"', "limit": 5},
            timeout=self.timeout,
        )
        if response.status_code != 200:
            return None
        try:
            raw = response.json()
        except ValueError:
            return None
        if not isinstance(raw, list):
            return None
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            data = entry.get("data") or {}
            item_doi = (data.get("DOI") or "").strip().lower()
            if item_doi == doi.lower():
                return self._summarize_item(entry)
        return None

    def find_item_in_collection_by_doi(self, doi: str, collection_key: str) -> dict | None:
        """Zwraca pozycję już w kolekcji o danym DOI, lub None."""
        item = self.find_item_by_doi(doi)
        if not item:
            return None
        collections = item.get("collections") or []
        if collection_key in collections:
            return item
        return None

    def list_collection_items(self, collection_key: str, limit: int = 20) -> list[dict]:
        """Ostatnie pozycje z kolekcji (sortowane po dacie dodania)."""
        user_id = self.resolve_user_id()
        limit = max(1, min(limit, 100))
        response = self._session.get(
            f"{ZOTERO_WEB_API_BASE}/users/{user_id}/collections/{collection_key}/items/top",
            params={"limit": limit, "sort": "dateAdded", "direction": "desc"},
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise ZoteroClientError(
                f"Web API list collection items failed: HTTP {response.status_code} — "
                f"{response.text[:500]}",
                response.status_code,
            )
        try:
            raw = response.json()
        except ValueError as exc:
            raise ZoteroClientError(
                f"list collection items: invalid JSON — {response.text[:200]}",
                response.status_code,
            ) from exc
        if not isinstance(raw, list):
            raise ZoteroClientError(
                f"list collection items: expected JSON array, got {type(raw).__name__}",
                response.status_code,
            )
        return [self._summarize_item(entry) for entry in raw if isinstance(entry, dict)]

    def get_item(self, item_key: str) -> dict | None:
        user_id = self.resolve_user_id()
        response = self._session.get(
            f"{ZOTERO_WEB_API_BASE}/users/{user_id}/items/{item_key}",
            timeout=self.timeout,
        )
        if response.status_code != 200:
            return None
        try:
            entry = response.json()
        except ValueError:
            return None
        if isinstance(entry, dict):
            return self._summarize_item(entry)
        return None

    def _summarize_item(self, entry: dict) -> dict:
        data = entry.get("data") or {}
        creators = data.get("creators") or []
        return {
            "key": entry.get("key", ""),
            "title": data.get("title", ""),
            "doi": data.get("DOI", ""),
            "date": data.get("date", ""),
            "itemType": data.get("itemType", ""),
            "creators": creators,
            "collections": data.get("collections") or [],
            "citation_text": format_citation_text(data),
        }

    def add_item_by_id(self, identifier: str, collection_key: str) -> dict:
        """Import DOI (lub innego identyfikatora) do kolekcji przez Web API."""
        doi = identifier.strip()
        existing = self.find_item_in_collection_by_doi(doi, collection_key)
        if existing:
            return {
                "duplicate": True,
                "via": "web_api",
                "key": existing["key"],
                "itemKey": existing["key"],
                "collection_key": collection_key,
                "existing": existing,
            }
        try:
            metadata = fetch_crossref_metadata(doi)
        except requests.RequestException as exc:
            raise ZoteroClientError(f"Crossref metadata failed: {exc}") from exc

        item = {
            "itemType": metadata.get("itemType", "journalArticle"),
            "title": metadata.get("title", doi),
            "DOI": doi,
            "creators": metadata.get("creators", []),
            "publicationTitle": metadata.get("publicationTitle", ""),
            "volume": metadata.get("volume", ""),
            "issue": metadata.get("issue", ""),
            "pages": metadata.get("pages", ""),
            "date": metadata.get("date", ""),
            "ISSN": metadata.get("ISSN", ""),
            # Kolekcja ustawiana przy tworzeniu — Web API nie obsługuje POST …/collections/…/items.
            "collections": [collection_key],
        }
        item = {k: v for k, v in item.items() if v}

        user_id = self.resolve_user_id()
        create_response = self._session.post(
            f"{ZOTERO_WEB_API_BASE}/users/{user_id}/items",
            json=[item],
            timeout=self.timeout,
        )
        if create_response.status_code not in (200, 201, 207):
            raise ZoteroClientError(
                f"Web API create item failed: HTTP {create_response.status_code} — "
                f"{create_response.text[:500]}",
                create_response.status_code,
            )

        item_key = self._extract_created_item_key(create_response)
        if not item_key:
            raise ZoteroClientError(
                "Web API: utworzono pozycję, ale nie udało się odczytać klucza.",
                create_response.status_code,
            )

        try:
            create_body = create_response.json() if create_response.text else {}
        except ValueError:
            create_body = {"raw": create_response.text}

        return {
            "success": True,
            "via": "web_api",
            "key": item_key,
            "itemKey": item_key,
            "collection_key": collection_key,
            "result": create_body,
        }

    def _extract_created_item_key(self, response: requests.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return ""

        if isinstance(body, dict):
            successful = body.get("successful")
            if isinstance(successful, dict):
                for entry in successful.values():
                    if isinstance(entry, dict) and entry.get("key"):
                        return str(entry["key"])
            if body.get("key"):
                return str(body["key"])

        if isinstance(body, list) and body:
            first = body[0]
            if isinstance(first, dict) and first.get("key"):
                return str(first["key"])

        return ""

    def health_summary(self) -> dict:
        summary = {"api": "web", "configured": True, "user_id": None, "collections_count": None}
        try:
            summary["user_id"] = self.resolve_user_id()
            summary["collections_count"] = len(self.list_collections())
        except ZoteroClientError as exc:
            summary["error"] = str(exc)
        return summary
