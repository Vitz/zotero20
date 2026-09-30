"""Walidacja i normalizacja ręcznych pozycji Zotero (zakładka Inne)."""

from __future__ import annotations

from typing import Any

# Typy obsługiwane w v1 (P0 + łatwe rozszerzenia).
ALLOWED_ITEM_TYPES: frozenset[str] = frozenset(
    {
        "preprint",
        "journalArticle",
        "book",
        "bookSection",
        "thesis",
        "report",
        "webpage",
    }
)

ITEM_TYPE_LABELS_PL: dict[str, str] = {
    "preprint": "Preprint / artykuł bez DOI",
    "journalArticle": "Artykuł (bez DOI)",
    "book": "Książka",
    "bookSection": "Rozdział książki",
    "thesis": "Praca dyplomowa",
    "report": "Raport",
    "webpage": "Strona WWW",
}

# Pola wspólne dla wszystkich typów (poza itemType / collections).
_COMMON_FIELDS: frozenset[str] = frozenset(
    {
        "title",
        "creators",
        "date",
        "url",
        "abstractNote",
        "language",
        "extra",
        "DOI",
        "accessDate",
        "rights",
        "shortTitle",
    }
)

_TYPE_FIELDS: dict[str, frozenset[str]] = {
    "preprint": frozenset({"repository", "archiveID", "archive", "libraryCatalog", "callNumber"}),
    "journalArticle": frozenset(
        {
            "publicationTitle",
            "volume",
            "issue",
            "pages",
            "series",
            "seriesTitle",
            "seriesText",
            "journalAbbreviation",
            "ISSN",
        }
    ),
    "book": frozenset(
        {
            "publisher",
            "place",
            "ISBN",
            "numPages",
            "edition",
            "volume",
            "series",
            "seriesNumber",
        }
    ),
    "bookSection": frozenset(
        {
            "bookTitle",
            "publisher",
            "place",
            "ISBN",
            "pages",
            "edition",
            "series",
            "seriesNumber",
            "volume",
        }
    ),
    "thesis": frozenset({"university", "place", "thesisType", "numPages"}),
    "report": frozenset(
        {
            "institution",
            "reportNumber",
            "place",
            "pages",
            "seriesTitle",
            "seriesNumber",
        }
    ),
    "webpage": frozenset({"websiteTitle", "websiteType"}),
}

_CREATOR_TYPES: frozenset[str] = frozenset(
    {
        "author",
        "editor",
        "contributor",
        "translator",
        "seriesEditor",
        "bookAuthor",
        "reviewedAuthor",
    }
)


class ManualItemValidationError(ValueError):
    """Nieprawidłowy payload ręcznej pozycji."""


def allowed_fields_for(item_type: str) -> frozenset[str]:
    return _COMMON_FIELDS | _TYPE_FIELDS.get(item_type, frozenset())


def _strip_empty(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        cleaned = []
        for entry in value:
            stripped = _strip_empty(entry)
            if stripped in ("", None, [], {}):
                continue
            cleaned.append(stripped)
        return cleaned
    if isinstance(value, dict):
        cleaned = {}
        for key, raw in value.items():
            stripped = _strip_empty(raw)
            if stripped in ("", None, [], {}):
                continue
            cleaned[key] = stripped
        return cleaned
    return value


def _normalize_creator(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    creator_type = str(raw.get("creatorType") or "author").strip() or "author"
    if creator_type not in _CREATOR_TYPES:
        creator_type = "author"

    name = str(raw.get("name") or "").strip()
    first = str(raw.get("firstName") or "").strip()
    last = str(raw.get("lastName") or "").strip()
    if name:
        out = {"creatorType": creator_type, "name": name}
    elif first or last:
        out = {"creatorType": creator_type}
        if first:
            out["firstName"] = first
        if last:
            out["lastName"] = last
    else:
        return None

    orcid = str(raw.get("ORCID") or raw.get("orcid") or "").strip()
    if orcid:
        out["ORCID"] = orcid
    return out


def validate_and_normalize_item(
    payload: dict,
    *,
    collection_key: str,
    require_title: bool = True,
) -> dict:
    """
    Waliduje whitelist typów/pól, czyści puste wartości, ustawia collections.
    Zwraca gotowy obiekt data do POST …/items.
    """
    if not isinstance(payload, dict):
        raise ManualItemValidationError("Payload musi być obiektem JSON.")

    item_type = str(payload.get("itemType") or "").strip()
    if item_type not in ALLOWED_ITEM_TYPES:
        allowed = ", ".join(sorted(ALLOWED_ITEM_TYPES))
        raise ManualItemValidationError(
            f"Nieobsługiwany itemType: {item_type or '(brak)'}. Dozwolone: {allowed}."
        )

    allowed = allowed_fields_for(item_type)
    unknown = [
        key
        for key in payload.keys()
        if key not in allowed and key not in ("itemType", "collections", "collection_key")
    ]
    if unknown:
        raise ManualItemValidationError(
            "Niedozwolone pola dla typu "
            f"{item_type}: {', '.join(sorted(unknown))}."
        )

    item: dict[str, Any] = {"itemType": item_type}
    for key in allowed:
        if key == "creators":
            continue
        if key not in payload:
            continue
        value = _strip_empty(payload.get(key))
        if value in ("", None, [], {}):
            continue
        if not isinstance(value, (str, int, float, bool)):
            # Pola skalarne Zotero — listy poza creators odrzucamy.
            if key != "creators":
                raise ManualItemValidationError(f"Pole {key} musi być tekstem.")
        item[key] = str(value).strip() if isinstance(value, str) else value

    creators_raw = payload.get("creators")
    if creators_raw is not None:
        if not isinstance(creators_raw, list):
            raise ManualItemValidationError("Pole creators musi być listą.")
        creators = []
        for entry in creators_raw:
            normalized = _normalize_creator(entry)
            if normalized:
                creators.append(normalized)
        if creators:
            item["creators"] = creators

    title = str(item.get("title") or "").strip()
    if require_title and not title:
        raise ManualItemValidationError("Wymagane pole: title.")

    coll = str(collection_key or "").strip()
    if not coll:
        raise ManualItemValidationError("Wymagane pole: collection_key.")
    if len(coll) != 8 or not coll.isalnum():
        raise ManualItemValidationError(
            "collection_key musi mieć dokładnie 8 znaków alfanumerycznych."
        )

    item["collections"] = [coll]
    return item


def gemini_response_schema(item_type: str) -> dict:
    """JSON Schema (Gemini responseSchema) dla draftu danego typu."""
    if item_type not in ALLOWED_ITEM_TYPES:
        raise ManualItemValidationError(f"Nieobsługiwany itemType: {item_type}.")

    string_props = {
        field: {"type": "STRING"}
        for field in sorted(allowed_fields_for(item_type) - {"creators"})
    }
    properties = {
        "itemType": {"type": "STRING"},
        "creators": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "creatorType": {"type": "STRING"},
                    "firstName": {"type": "STRING"},
                    "lastName": {"type": "STRING"},
                    "name": {"type": "STRING"},
                },
            },
        },
        **string_props,
    }
    # Gemini 2.0 wymaga propertyOrdering przy structured output.
    ordering = ["itemType", "title", "creators", "date", "url", "abstractNote"]
    for key in sorted(properties.keys()):
        if key not in ordering:
            ordering.append(key)
    return {
        "type": "OBJECT",
        "properties": properties,
        "propertyOrdering": ordering,
    }
