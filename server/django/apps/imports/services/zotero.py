from __future__ import annotations

import logging
import time

import requests
from django.conf import settings

from apps.imports.middleware import extract_item_orcid

from .bibliography import DEFAULT_LOCALE, parse_formatted_items, resolve_style_id
from .citation import format_citation_text, parse_citation_html
from .exceptions import ZoteroClientError

logger = logging.getLogger(__name__)

__all__ = ["ZoteroClient", "ZoteroClientError", "get_zotero_client", "format_citation_text"]


class ZoteroClient:
    def __init__(self, base_url: str | None = None, timeout: int = 60):
        self.base_url = (base_url or settings.ZOTERO_URL).rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}{path}"
        response = self._session.request(method, url, timeout=self.timeout, **kwargs)
        return response

    def ping(self) -> dict:
        response = self._request("GET", "/connector/ping")
        if response.status_code != 200:
            raise ZoteroClientError(
                f"Zotero ping failed: HTTP {response.status_code}",
                response.status_code,
            )
        try:
            return response.json()
        except ValueError:
            return {"raw": response.text}

    def api_plus_health(self) -> dict | None:
        response = self._request("GET", "/api/plus/health")
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise ZoteroClientError(
                f"api-plus health failed: HTTP {response.status_code}",
                response.status_code,
            )
        try:
            return response.json()
        except ValueError:
            return {"raw": response.text}

    def _summarize_item(self, entry: dict) -> dict:
        data = entry.get("data") or {}
        creators = data.get("creators") or []
        return {
            "key": entry.get("key", ""),
            "title": data.get("title", ""),
            "journal_abbrev": (data.get("journalAbbreviation") or "").strip(),
            "doi": data.get("DOI", ""),
            "orcid": extract_item_orcid(data),
            "date": data.get("date", ""),
            "itemType": data.get("itemType", ""),
            "creators": creators,
            "collections": data.get("collections") or [],
            "citation_text": format_citation_text(data),
        }

    def find_item_by_doi(self, doi: str) -> dict | None:
        response = self._request(
            "GET",
            "/api/users/0/items",
            params={"q": f'doi:"{doi.strip()}"', "limit": 5},
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
            if item_doi == doi.strip().lower():
                return self._summarize_item(entry)
        return None

    def find_item_in_collection_by_doi(self, doi: str, collection_key: str) -> dict | None:
        item = self.find_item_by_doi(doi)
        if not item:
            return None
        collections = item.get("collections") or []
        if collection_key in collections:
            return item
        return None

    def list_collection_items(self, collection_key: str, limit: int = 20) -> list[dict]:
        limit = max(1, min(limit, 100))
        response = self._request(
            "GET",
            f"/api/users/0/collections/{collection_key}/items/top",
            params={"limit": limit, "sort": "dateAdded", "direction": "desc"},
        )
        if response.status_code != 200:
            raise ZoteroClientError(
                f"list collection items failed: HTTP {response.status_code} — {response.text[:500]}",
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

    def _fetch_item_entry(self, item_key: str) -> dict:
        response = self._request("GET", f"/api/users/0/items/{item_key}")
        if response.status_code == 404:
            raise ZoteroClientError("Pozycja nie istnieje w bibliotece Zotero.", 404)
        if response.status_code != 200:
            raise ZoteroClientError(
                f"get item failed: HTTP {response.status_code} — {response.text[:500]}",
                response.status_code,
            )
        try:
            entry = response.json()
        except ValueError as exc:
            raise ZoteroClientError(
                f"get item: invalid JSON — {response.text[:200]}",
                response.status_code,
            ) from exc
        if not isinstance(entry, dict):
            raise ZoteroClientError(
                f"get item: expected JSON object, got {type(entry).__name__}",
                response.status_code,
            )
        return entry

    def get_item(self, item_key: str) -> dict | None:
        try:
            entry = self._fetch_item_entry(item_key)
        except ZoteroClientError as exc:
            if exc.status_code == 404:
                return None
            raise
        return self._summarize_item(entry)

    def remove_item_from_collection(self, collection_key: str, item_key: str) -> dict:
        """Usuwa pozycję z kolekcji (nie kasuje jej z biblioteki Zotero)."""
        entry = self._fetch_item_entry(item_key)
        data = entry.get("data") or {}
        collections = list(data.get("collections") or [])
        if collection_key not in collections:
            return {
                "removed": False,
                "reason": "not_in_collection",
                "item_key": item_key,
                "collection_key": collection_key,
            }

        version = entry.get("version")
        if version is None:
            raise ZoteroClientError("Brak wersji pozycji — nie można zaktualizować w Zotero.")

        new_collections = [key for key in collections if key != collection_key]
        patch_body = {
            "key": item_key,
            "version": version,
            "collections": new_collections,
        }
        response = self._request(
            "PATCH",
            f"/api/users/0/items/{item_key}",
            json=patch_body,
            headers={"If-Unmodified-Since-Version": str(version)},
        )
        if response.status_code not in (200, 204):
            raise ZoteroClientError(
                f"remove from collection failed: HTTP {response.status_code} — "
                f"{response.text[:500]}",
                response.status_code,
            )
        return {
            "removed": True,
            "item_key": item_key,
            "collection_key": collection_key,
            "via": "local_api",
        }

    def fetch_item_citation(
        self,
        item_key: str,
        style: str,
        locale: str = DEFAULT_LOCALE,
    ) -> str:
        resolved_style = resolve_style_id(style)
        last_error: ZoteroClientError | None = None
        response = self._request(
            "GET",
            f"/api/users/0/items/{item_key}",
            params={"format": "citation", "style": resolved_style, "locale": locale},
            headers={"Accept": "text/html"},
        )
        if response.status_code == 200:
            text = parse_citation_html(response.text)
            if text:
                return text
        else:
            last_error = ZoteroClientError(
                f"citation export failed: HTTP {response.status_code} — {response.text[:500]}",
                response.status_code,
            )

        try:
            formatted = self.fetch_items_formatted([item_key], resolved_style, locale)
            citation = (formatted.get(item_key) or {}).get("citation", "").strip()
            if citation:
                return citation
        except ZoteroClientError as exc:
            if last_error is None:
                last_error = exc

        item = self.get_item(item_key)
        if item:
            text = (item.get("citation_text") or format_citation_text(item)).strip()
            if text and text != "(?)":
                return text

        if last_error:
            raise last_error
        return "(?)"

    def add_item_by_id(self, identifier: str, collection_key: str) -> dict:
        doi = identifier.strip()
        existing = self.find_item_in_collection_by_doi(doi, collection_key)
        if existing:
            return {
                "duplicate": True,
                "via": "local_api",
                "key": existing["key"],
                "itemKey": existing["key"],
                "collection_key": collection_key,
                "existing": existing,
            }
        response = self._request(
            "POST",
            "/api/plus/add-item-by-id",
            json={"identifier": identifier, "collectionKey": collection_key},
            headers={"Content-Type": "application/json"},
        )
        if response.status_code in (200, 201):
            try:
                return response.json()
            except ValueError:
                return {"success": True, "raw": response.text}

        if response.status_code == 404:
            return self._add_item_via_local_api(identifier, collection_key)

        detail = response.text[:500]
        raise ZoteroClientError(
            f"add-item-by-id failed: HTTP {response.status_code} — {detail}",
            response.status_code,
        )

    def _add_item_via_local_api(self, doi: str, collection_key: str) -> dict:
        """Fallback when zotero-api-plus is not installed."""
        from .doi import fetch_crossref_metadata

        metadata = fetch_crossref_metadata(doi)
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
        }
        item = {k: v for k, v in item.items() if v}

        response = self._request(
            "POST",
            f"/api/users/0/collections/{collection_key}/items",
            json=[item],
            headers={"Content-Type": "application/json"},
        )
        if response.status_code not in (200, 201):
            raise ZoteroClientError(
                f"Local API add item failed: HTTP {response.status_code} — {response.text[:500]}",
                response.status_code,
            )

        try:
            body = response.json()
        except ValueError:
            body = {"raw": response.text}

        return {"success": True, "via": "local_api", "result": body}

    def create_item(self, payload: dict, collection_key: str) -> dict:
        """Tworzy pozycję z gotowego payloadu Zotero w kolekcji (Local API)."""
        item = dict(payload)
        item.pop("collections", None)
        item = {k: v for k, v in item.items() if v not in ("", None, [], {})}

        response = self._request(
            "POST",
            f"/api/users/0/collections/{collection_key}/items",
            json=[item],
            headers={"Content-Type": "application/json"},
        )
        if response.status_code not in (200, 201, 207):
            raise ZoteroClientError(
                f"Local API create item failed: HTTP {response.status_code} — "
                f"{response.text[:500]}",
                response.status_code,
            )

        item_key = self._extract_created_key_(response)
        try:
            body = response.json() if response.text else {}
        except ValueError:
            body = {"raw": response.text}

        return {
            "success": True,
            "via": "local_api",
            "key": item_key,
            "itemKey": item_key,
            "collection_key": collection_key,
            "title": item.get("title", ""),
            "result": body,
        }

    def list_collections(self) -> list[dict]:
        response = self._request("GET", "/api/users/0/collections")
        if response.status_code != 200:
            raise ZoteroClientError(
                f"list collections failed: HTTP {response.status_code} — {response.text[:500]}",
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

    def create_collection(self, name: str) -> dict:
        """Tworzy kolekcję w bibliotece Local API. Zwraca {key, name}."""
        name = (name or "").strip()
        if not name:
            raise ZoteroClientError("Nazwa kolekcji nie może być pusta.", 400)

        response = self._request(
            "POST",
            "/api/users/0/collections",
            json=[{"name": name, "parentCollection": False}],
            headers={"Content-Type": "application/json"},
        )
        if response.status_code not in (200, 201, 207):
            raise ZoteroClientError(
                f"create collection failed: HTTP {response.status_code} — "
                f"{response.text[:500]}",
                response.status_code,
            )

        key = self._extract_created_key_(response)
        if not key:
            raise ZoteroClientError(
                "Utworzono kolekcję, ale nie udało się odczytać klucza.",
                response.status_code,
            )
        return {"key": key, "name": name}

    @staticmethod
    def _extract_created_key_(response: requests.Response) -> str:
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

    def fetch_item_bibliography(
        self,
        item_key: str,
        style: str,
        locale: str = DEFAULT_LOCALE,
    ) -> str:
        resolved_style = resolve_style_id(style)
        response = self._request(
            "GET",
            f"/api/users/0/items/{item_key}",
            params={"format": "bib", "style": resolved_style, "locale": locale},
            headers={"Accept": "text/html"},
        )
        if response.status_code != 200:
            raise ZoteroClientError(
                f"item bibliography export failed: HTTP {response.status_code} — "
                f"{response.text[:500]}",
                response.status_code,
            )
        return response.text

    def fetch_items_formatted(
        self,
        item_keys: list[str],
        style: str,
        locale: str = DEFAULT_LOCALE,
    ) -> dict[str, dict[str, str]]:
        """Zbiorczo pobiera bib+citation dla wielu pozycji (jedno żądanie, mapowanie po kluczu)."""
        resolved_style = resolve_style_id(style)
        keys = [str(key).strip() for key in item_keys if str(key).strip()]
        if not keys:
            return {}
        response = self._request(
            "GET",
            "/api/users/0/items",
            params={
                "itemKey": ",".join(keys),
                "format": "json",
                "include": "bib,citation",
                "style": resolved_style,
                "locale": locale,
                "limit": len(keys),
            },
        )
        if response.status_code != 200:
            raise ZoteroClientError(
                f"batch item export failed: HTTP {response.status_code} — {response.text[:500]}",
                response.status_code,
            )
        return parse_formatted_items(response.json(), keys)

    def fetch_collection_bibliography(
        self,
        collection_key: str,
        style: str,
        locale: str = DEFAULT_LOCALE,
    ) -> str:
        response = self._request(
            "GET",
            f"/api/users/0/collections/{collection_key}/items/top",
            params={"format": "bib", "style": style, "locale": locale},
            headers={"Accept": "text/html"},
        )
        if response.status_code != 200:
            raise ZoteroClientError(
                f"bibliography export failed: HTTP {response.status_code} — {response.text[:500]}",
                response.status_code,
            )
        return response.text

    def reachability_check(self, timeout: float = 5.0) -> dict:
        """Lekki ping Local API (connector/ping) — bez api-plus ani citeproc."""
        previous = self.timeout
        self.timeout = timeout
        try:
            self.ping()
            return {"api": "local", "reachable": True, "user_id": None}
        finally:
            self.timeout = previous

    def health_summary(self) -> dict:
        summary = {"zotero_url": self.base_url, "ping": None, "api_plus": None}
        try:
            summary["ping"] = self.ping()
        except ZoteroClientError as exc:
            summary["ping_error"] = str(exc)

        try:
            summary["api_plus"] = self.api_plus_health()
        except ZoteroClientError as exc:
            summary["api_plus_error"] = str(exc)

        return summary

    def wait_until_ready(self, retries: int = 30, delay: float = 2.0) -> bool:
        for attempt in range(retries):
            try:
                self.ping()
                return True
            except ZoteroClientError:
                logger.info("Zotero not ready (attempt %s/%s)", attempt + 1, retries)
                time.sleep(delay)
        return False


def get_zotero_client():
    """Zwraca klienta Web API (gdy skonfigurowany) lub lokalnego Zotero."""
    from .zotero_web import ZoteroWebClient, web_api_configured

    if web_api_configured():
        return ZoteroWebClient(), "web"
    return ZoteroClient(), "local"
