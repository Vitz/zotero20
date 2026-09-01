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
