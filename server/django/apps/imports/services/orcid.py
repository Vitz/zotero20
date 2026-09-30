from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import requests
from django.conf import settings

from .exceptions import ZoteroClientError
from .zotero import ZoteroClient, get_zotero_client

logger = logging.getLogger(__name__)


@dataclass
class OrcidImportReport:
    orcid: str
    study: str
    added: list[str] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "orcid": self.orcid,
            "study": self.study,
            "added": self.added,
            "skipped": self.skipped,
            "errors": self.errors,
            "summary": {
                "added_count": len(self.added),
                "skipped_count": len(self.skipped),
                "error_count": len(self.errors),
            },
        }


def _orcid_headers() -> dict:
    return {
        "Accept": "application/json",
        "User-Agent": "zotero20/1.0 (mailto:admin@keyweb.pl)",
    }


def fetch_orcid_works(orcid: str) -> list[dict]:
    works: list[dict] = []
    url = f"{settings.ORCID_PUBLIC_API}/{orcid}/works"
    start = 0
    page_size = 100

    while url:
        response = requests.get(url, headers=_orcid_headers(), timeout=60)
        response.raise_for_status()
        payload = response.json()

        group = payload.get("group") or []
        for entry in group:
            summaries = entry.get("work-summary") or []
            if summaries:
                works.append(summaries[0])

        next_url = None
        for link in payload.get("link") or []:
            if link.get("rel") == "next":
                next_url = link.get("href")
                break

        url = next_url
        start += page_size
        if url:
            time.sleep(settings.ORCID_RATE_LIMIT_DELAY)

    return works


def extract_doi_from_work(work: dict) -> str | None:
    external_ids = work.get("external-ids") or {}
    for ext in external_ids.get("external-id") or []:
        if (ext.get("external-id-type") or "").lower() == "doi":
            value = (ext.get("external-id-value") or "").strip()
            if value:
                return value
    return None


def import_orcid_works(
    orcid: str,
    study: str,
    collection_key: str,
    limit: int = 50,
    zotero: ZoteroClient | None = None,
) -> OrcidImportReport:
    if zotero is None:
        client, _source = get_zotero_client()
    else:
        client = zotero
    report = OrcidImportReport(orcid=orcid, study=study)

    try:
        works = fetch_orcid_works(orcid)
    except requests.RequestException as exc:
        report.errors.append({"stage": "orcid_fetch", "message": str(exc)})
        return report

    for work in works[:limit]:
        title = (work.get("title") or {}).get("title", {}).get("value", "")
        doi = extract_doi_from_work(work)

        if not doi:
            report.skipped.append(
                {
                    "title": title,
                    "reason": "brak DOI",
                    "put_code": work.get("put-code"),
                }
            )
            continue

        try:
            result = client.add_item_by_id(doi, collection_key)
            if isinstance(result, dict) and result.get("duplicate"):
                report.skipped.append(
                    {
                        "doi": doi,
                        "title": title,
                        "reason": "już w kolekcji",
                        "item_key": result.get("key", ""),
                    }
                )
                continue
            report.added.append(doi)
            time.sleep(settings.ORCID_RATE_LIMIT_DELAY)
        except ZoteroClientError as exc:
            report.errors.append({"doi": doi, "title": title, "message": str(exc)})

    return report
