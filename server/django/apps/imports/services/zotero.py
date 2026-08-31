from __future__ import annotations

import logging
import time

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class ZoteroClientError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


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

    def add_item_by_id(self, identifier: str, collection_key: str) -> dict:
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
