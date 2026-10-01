from __future__ import annotations

import re

import requests

_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "of",
        "the",
        "for",
        "in",
        "on",
        "to",
        "or",
        "de",
        "des",
        "du",
        "la",
        "le",
        "les",
        "und",
        "der",
        "die",
        "das",
        "van",
        "von",
        "z",
        "za",
        "ze",
        "w",
        "we",
        "i",
        "oraz",
        "nad",
        "pod",
    }
)


def abbreviate_journal_title(title: str) -> str:
    """Skrót z pełnej nazwy czasopisma (inicjały znaczących słów)."""
    cleaned = re.sub(r"[^\w\s\-]", " ", (title or "").strip(), flags=re.UNICODE)
    words = [w for w in cleaned.split() if w]
    if not words:
        return ""
    significant = [w for w in words if w.casefold() not in _STOPWORDS and len(w) > 1]
    if not significant:
        significant = words
    if len(significant) == 1:
        return significant[0][:12].upper()
    return "".join(w[0].upper() for w in significant[:8])


def resolve_journal_abbrev(
    journal_abbreviation: str = "", publication_title: str = ""
) -> str:
    abbrev = (journal_abbreviation or "").strip()
    if abbrev:
        return abbrev
    return abbreviate_journal_title(publication_title)


def fetch_crossref_metadata(doi: str) -> dict:
    response = requests.get(
        f"https://api.crossref.org/works/{doi}",
        headers={"Accept": "application/json"},
        timeout=30,
    )
    response.raise_for_status()
    message = response.json().get("message", {})

    creators = []
    for author in message.get("author", []):
        creator = {"creatorType": "author"}
        if author.get("given"):
            creator["firstName"] = author["given"]
        if author.get("family"):
            creator["lastName"] = author["family"]
        if creator.get("firstName") or creator.get("lastName"):
            creators.append(creator)

    title_list = message.get("title") or []
    container = message.get("container-title") or []
    short_container = message.get("short-container-title") or []
    publication_title = container[0] if container else ""
    journal_abbreviation = (short_container[0] if short_container else "").strip()
    if not journal_abbreviation:
        journal_abbreviation = abbreviate_journal_title(publication_title)

    date_parts = message.get("issued", {}).get("date-parts", [[]])
    date = ""
    if date_parts and date_parts[0]:
        date = "-".join(str(part) for part in date_parts[0])

    return {
        "itemType": "journalArticle",
        "title": title_list[0] if title_list else doi,
        "creators": creators,
        "publicationTitle": publication_title,
        "journalAbbreviation": journal_abbreviation,
        "volume": str(message.get("volume", "") or ""),
        "issue": str(message.get("issue", "") or ""),
        "pages": message.get("page", "") or "",
        "date": date,
        "ISSN": (message.get("ISSN") or [""])[0],
    }
