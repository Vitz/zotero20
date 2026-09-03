"""Public bibliographic fields for GET /cite/<item_key> (Google Docs citation links)."""

from __future__ import annotations

import re
from urllib.parse import quote

from django.conf import settings

from .exceptions import ZoteroClientError
from .zotero import get_zotero_client

ITEM_KEY_RE = re.compile(r"^[A-Za-z0-9]{1,32}$")
YEAR_RE = re.compile(r"\b((?:1[6-9]|20|21)\d{2})\b")
DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$")
CACHE_CONTROL = "public, max-age=30"


def normalize_item_key(item_key: str) -> str:
    return (item_key or "").strip()


def is_valid_item_key(item_key: str) -> bool:
    return bool(ITEM_KEY_RE.match(item_key or ""))


def extract_year(date: str) -> str:
    text = str(date or "").strip()
    if not text:
        return ""
    match = YEAR_RE.search(text)
    if match:
        return match.group(1)
    if len(text) >= 4 and text[:4].isdigit():
        return text[:4]
    return ""


def format_authors(creators) -> str:
    if not isinstance(creators, list):
        return ""
    authors = [c for c in creators if isinstance(c, dict) and _is_author(c)]
    if not authors:
        authors = [c for c in creators if isinstance(c, dict)]
    names = []
    for creator in authors:
        name = _creator_name(creator)
        if name:
            names.append(name)
    return "; ".join(names)


def _is_author(creator: dict) -> bool:
    kind = str(creator.get("creatorType") or "author").strip().lower()
    return kind in ("author", "")


def _creator_name(creator: dict) -> str:
    last = str(creator.get("lastName") or "").strip()
    first = str(creator.get("firstName") or "").strip()
    name = str(creator.get("name") or "").strip()
    if last and first:
        return f"{last}, {first}"
    return last or name or first


def normalize_doi(doi: str) -> str:
    value = str(doi or "").strip()
    value = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^doi:\s*", "", value, flags=re.IGNORECASE)
    value = value.strip()
    if not value or not DOI_RE.match(value):
        return ""
    return value


def doi_url(doi: str) -> str:
    cleaned = normalize_doi(doi)
    if not cleaned:
        return ""
    return f"https://doi.org/{cleaned}"


def http_url(url: str) -> str:
    value = str(url or "").strip()
    if value.lower().startswith(("http://", "https://")):
        return value
    return ""


def zotero_org_url(item_key: str, library_user_id: str) -> str:
    user_id = str(library_user_id or "").strip()
    key = str(item_key or "").strip()
    if not key or not user_id or user_id == "0":
        return ""
    if not user_id.isdigit():
        return ""
    return f"https://www.zotero.org/users/{user_id}/items/{quote(key, safe='')}"


def public_cite_payload(entry: dict, *, library_user_id: str = "") -> dict:
    """Bibliographic fields only — no collections, notes, extra, or credentials."""
    data = entry.get("data") if isinstance(entry.get("data"), dict) else entry
    if not isinstance(data, dict):
        data = {}
    key = str(entry.get("key") or data.get("key") or "").strip()
    title = str(data.get("title") or "").strip()
    doi = normalize_doi(data.get("DOI") or data.get("doi") or "")
    journal = str(
        data.get("publicationTitle") or data.get("journalAbbreviation") or ""
    ).strip()
    abstract = str(data.get("abstractNote") or "").strip()
    date = str(data.get("date") or "").strip()
    year = extract_year(date)
    authors = format_authors(data.get("creators") or [])
    payload = {
        "item_key": key,
        "title": title,
        "authors": authors,
        "year": year,
        "date": date,
        "journal": journal,
        "doi": doi,
        "doi_url": doi_url(doi),
        "abstract": abstract,
        "item_type": str(data.get("itemType") or "").strip(),
        "url": http_url(data.get("url") or ""),
        "zotero_url": zotero_org_url(key, library_user_id),
    }
    return payload


def _library_user_id(client) -> str:
    resolve = getattr(client, "resolve_user_id", None)
    if callable(resolve):
        try:
            return str(resolve() or "").strip()
        except ZoteroClientError:
            pass
    return str(getattr(settings, "ZOTERO_WEB_USER_ID", "") or "").strip()


def get_public_cite_item(item_key: str) -> dict | None:
    """Fetch one item via the configured Zotero client (Web API when set)."""
    key = normalize_item_key(item_key)
    if not is_valid_item_key(key):
        return None
    client, _source = get_zotero_client()
    try:
        entry = client._fetch_item_entry(key)
    except ZoteroClientError as exc:
        if exc.status_code == 404:
            return None
        raise
    return public_cite_payload(entry, library_user_id=_library_user_id(client))
