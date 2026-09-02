from __future__ import annotations

import html
import re
from html.parser import HTMLParser

from .exceptions import ZoteroClientError

DEFAULT_STYLE_ID = "apa"

# Popularne style CSL (identyfikator = fragment URL zotero.org/styles/…)
CSL_STYLES: list[dict[str, str]] = [
    {"id": "apa", "label": "APA 7th edition"},
    {"id": "ieee", "label": "IEEE"},
    {"id": "vancouver", "label": "Vancouver"},
    {"id": "chicago-author-date", "label": "Chicago (autor–data)"},
    {"id": "harvard-cite-them-right", "label": "Harvard (Cite Them Right)"},
    {"id": "modern-language-association", "label": "MLA 9th edition"},
]

_STYLE_IDS = {style["id"] for style in CSL_STYLES}

# Style numeryczne: cytowanie w tekście to [1], a bibliografia jest w kolejności cytowania.
NUMERIC_STYLE_IDS = {"ieee", "vancouver"}

# Zotero numeruje każdą pozycję pobraną osobno od 1 — numer trzeba odciąć i nadać własny.
_LEADING_NUMBER_RE = re.compile(r"^\s*(?:\[\s*\d+\s*\]|\(\s*\d+\s*\)|\d+\s*[.)])\s*")


def list_styles() -> list[dict[str, str]]:
    return [dict(style) for style in CSL_STYLES]


def resolve_style_id(style_id: str | None) -> str:
    normalized = (style_id or "").strip().lower()
    if not normalized:
        return DEFAULT_STYLE_ID
    if normalized in _STYLE_IDS:
        return normalized
    # Akceptuj pełny URL stylu CSL
    match = re.search(r"/styles/([a-z0-9-]+)/?$", normalized, re.IGNORECASE)
    if match and match.group(1) in _STYLE_IDS:
        return match.group(1)
    raise ValueError(f"Nieobsługiwany styl: {style_id}")


def style_label(style_id: str) -> str:
    for style in CSL_STYLES:
        if style["id"] == style_id:
            return style["label"]
    return style_id


def is_numeric_style(style_id: str) -> bool:
    return (style_id or "").strip().lower() in NUMERIC_STYLE_IDS


def strip_leading_number(text: str) -> str:
    return _LEADING_NUMBER_RE.sub("", text or "").strip()


def dedupe_item_keys(item_keys) -> list[str]:
    """Unikalne klucze w kolejności pierwszego wystąpienia (kolejność cytowania)."""
    ordered: list[str] = []
    seen: set[str] = set()
    for raw in item_keys or []:
        key = str(raw).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


class _BibHtmlParser(HTMLParser):
    """Wyciąga wpisy z odpowiedzi Zotero format=bib (div.csl-entry)."""

    def __init__(self) -> None:
        super().__init__()
        self.entries: list[str] = []
        self._entry_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "div":
            return
        classes = dict(attrs).get("class", "") or ""
        if "csl-entry" in classes.split():
            self._entry_depth = 1
            self._parts = []
        elif self._entry_depth > 0:
            self._entry_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag != "div" or self._entry_depth == 0:
            return
        if self._entry_depth == 1:
            text = html.unescape("".join(self._parts))
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                self.entries.append(text)
            self._entry_depth = 0
            self._parts = []
        else:
            self._entry_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._entry_depth > 0:
            self._parts.append(data)


def parse_bib_html(bib_html: str) -> list[str]:
    if not bib_html or not bib_html.strip():
        return []
    parser = _BibHtmlParser()
    parser.feed(bib_html)
    if parser.entries:
        return parser.entries
    # Fallback: usuń tagi i podziel na linie
    plain = re.sub(r"<[^>]+>", "\n", bib_html)
    plain = html.unescape(plain)
    return [line.strip() for line in plain.splitlines() if line.strip()]


def parse_formatted_items(raw, requested_keys: list[str]) -> dict[str, dict[str, str]]:
    """Mapuje odpowiedź Zotero (format=json&include=bib,citation) na {item_key: {bib, citation}}."""
    if not isinstance(raw, list):
        return {}
    wanted = set(requested_keys)
    formatted: dict[str, dict[str, str]] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or "").strip()
        if not key or (wanted and key not in wanted):
            continue
        bib_entries = [item for item in parse_bib_html(entry.get("bib") or "") if item.strip()]
        if not bib_entries:
            continue
        citation_html = entry.get("citation") or ""
        citation = re.sub(r"<[^>]+>", "", citation_html)
        citation = re.sub(r"\s+", " ", html.unescape(citation)).strip()
        formatted[key] = {"bib": bib_entries[0], "citation": citation}
    return formatted


def _fetch_item_bibliography_entry(client, item_key: str, style_id: str) -> str:
    bib_html = client.fetch_item_bibliography(item_key, style_id)
    parsed = [entry for entry in parse_bib_html(bib_html) if entry.strip()]
    return parsed[0] if parsed else ""


def _fetch_item_citation_text(client, item_key: str, style_id: str) -> str:
    fetch = getattr(client, "fetch_item_citation", None)
    if fetch is None:
        return ""
    try:
        return (fetch(item_key, style_id) or "").strip()
    except Exception:  # noqa: BLE001 — cytowanie w tekście jest opcjonalne dla bibliografii
        return ""


def _fetch_formatted_items(
    client,
    item_keys: list[str],
    style_id: str,
    *,
    need_citations: bool,
) -> tuple[dict[str, dict[str, str]], list[str]]:
    """Zwraca {item_key: {"bib": …, "citation": …}} plus klucze, których nie udało się pobrać.

    Najpierw jedno zbiorcze żądanie (include=bib,citation), a dla braków — zapytania
    pojedyncze, żeby stary Local API bez ?itemKey= nadal działał.
    """
    formatted: dict[str, dict[str, str]] = {}

    batch = getattr(client, "fetch_items_formatted", None)
    if batch is not None:
        try:
            raw = batch(item_keys, style_id) or {}
        except Exception:  # noqa: BLE001 — fallback na zapytania pojedyncze
            raw = {}
        for key, value in raw.items():
            entry = (value or {}).get("bib", "").strip()
            if not entry:
                continue
            formatted[key] = {
                "bib": entry,
                "citation": (value or {}).get("citation", "").strip(),
            }

    missing: list[str] = []
    for item_key in item_keys:
        current = formatted.get(item_key)
        if current is None:
            try:
                entry = _fetch_item_bibliography_entry(client, item_key, style_id)
            except ZoteroClientError:
                entry = ""
            if not entry:
                missing.append(item_key)
                continue
            current = {"bib": entry, "citation": ""}
            formatted[item_key] = current
        if need_citations and not current["citation"]:
            current["citation"] = _fetch_item_citation_text(client, item_key, style_id)

    return formatted, missing


def build_document_citations(client, source: str, item_keys: list[str], style_id: str) -> dict:
    """Spójne cytowania w tekście i bibliografia dla pozycji cytowanych w dokumencie.

    Kolejność wejściowa to kolejność cytowania w dokumencie. Dla stylów numerycznych
    numery nadaje serwer (dzięki temu [1] w tekście = pozycja 1 w bibliografii),
    dla stylów autor–rok bibliografia jest sortowana alfabetycznie jak w Zotero.
    """
    resolved_style = resolve_style_id(style_id)
    ordered_keys = dedupe_item_keys(item_keys)
    if not ordered_keys:
        raise ValueError("Wymagana niepusta lista item_keys.")

    numeric = is_numeric_style(resolved_style)
    formatted, missing_keys = _fetch_formatted_items(
        client,
        ordered_keys,
        resolved_style,
        need_citations=not numeric,
    )
    present_keys = [key for key in ordered_keys if key in formatted]
    if not present_keys:
        raise ZoteroClientError(
            "Nie udało się sformatować bibliografii dla podanych pozycji "
            f"(styl {resolved_style})."
        )

    citations: list[dict[str, str]] = []
    if numeric:
        entries = []
        for index, item_key in enumerate(present_keys, start=1):
            entry = strip_leading_number(formatted[item_key]["bib"])
            entries.append(f"[{index}] {entry}")
            citations.append({"item_key": item_key, "citation_text": f"[{index}]"})
    else:
        entries = sorted(
            (formatted[key]["bib"] for key in present_keys),
            key=lambda entry: entry.casefold(),
        )
        for item_key in present_keys:
            citation = formatted[item_key]["citation"] or formatted[item_key]["bib"]
            citations.append({"item_key": item_key, "citation_text": citation})

    payload = {
        "source": source,
        "style": resolved_style,
        "style_label": style_label(resolved_style),
        "numeric": numeric,
        "item_count": len(entries),
        "item_keys": present_keys,
        "entries": entries,
        "citations": citations,
    }
    if missing_keys:
        payload["missing_item_keys"] = missing_keys
    return payload


def export_items_bibliography(client, source: str, item_keys: list[str], style_id: str) -> dict:
    """Bibliografia wybranych pozycji (bez cytowań w tekście)."""
    payload = build_document_citations(client, source, item_keys, style_id)
    payload.pop("citations", None)
    return payload


def export_collection_bibliography(client, source: str, collection_key: str, style_id: str) -> dict:
    """Pobiera sformatowaną bibliografię kolekcji przez Zotero API (format=bib)."""
    resolved_style = resolve_style_id(style_id)
    try:
        has_items = bool(client.list_collection_items(collection_key, limit=1))
    except Exception:
        has_items = False

    bib_html = client.fetch_collection_bibliography(collection_key, resolved_style)
    entries = [entry for entry in parse_bib_html(bib_html) if entry.strip()]

    if not entries and has_items:
        raise ZoteroClientError(
            "Kolekcja zawiera pozycje, ale Zotero nie zwróciło sformatowanej bibliografii "
            f"(styl {resolved_style}). Sprawdź styl CSL lub spróbuj ponownie."
        )

    return {
        "collection_key": collection_key,
        "source": source,
        "style": resolved_style,
        "style_label": style_label(resolved_style),
        "item_count": len(entries),
        "entries": entries,
        "html": bib_html,
    }
