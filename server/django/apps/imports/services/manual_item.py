"""Walidacja i normalizacja ręcznych pozycji Zotero (zakładka Inne)."""

from __future__ import annotations

from typing import Any

# Wszystkie regularne typy Zotero (bez note / attachment / annotation).
ALLOWED_ITEM_TYPES: frozenset[str] = frozenset(
    {
        "journalArticle",
        "encyclopediaArticle",
        "newspaperArticle",
        "magazineArticle",
        "radioBroadcast",
        "document",
        "artwork",
        "email",
        "film",
        "dictionaryEntry",
        "instantMessage",
        "book",
        "letter",
        "map",
        "conferencePaper",
        "audioRecording",
        "videoRecording",
        "standard",
        "computerProgram",
        "patent",
        "podcast",
        "thesis",
        "preprint",
        "presentation",
        "tvBroadcast",
        "bill",
        "report",
        "bookSection",
        "hearing",
        "manuscript",
        "case",
        "statute",
        "webpage",
        "forumPost",
        "blogPost",
        "interview",
        "dataset",
    }
)

ITEM_TYPE_LABELS_PL: dict[str, str] = {
    "journalArticle": "Artykuł (bez DOI)",
    "encyclopediaArticle": "Artykuł w encyklopedii",
    "newspaperArticle": "Artykuł z gazety",
    "magazineArticle": "Artykuł z magazynu",
    "radioBroadcast": "Audycja radiowa",
    "document": "Dokument",
    "artwork": "Dzieło sztuki",
    "email": "E-mail",
    "film": "Film",
    "dictionaryEntry": "Hasło słownikowe",
    "instantMessage": "Krótka wiadomość",
    "book": "Książka",
    "letter": "List",
    "map": "Mapa",
    "conferencePaper": "Materiał konferencyjny",
    "audioRecording": "Nagranie audio",
    "videoRecording": "Nagranie wideo",
    "standard": "Norma",
    "computerProgram": "Oprogramowanie",
    "patent": "Patent",
    "podcast": "Podcast",
    "thesis": "Praca dyplomowa",
    "preprint": "Preprint / artykuł bez DOI",
    "presentation": "Prezentacja",
    "tvBroadcast": "Program telewizyjny",
    "bill": "Projekt ustawy",
    "report": "Raport",
    "bookSection": "Rozdział książki",
    "hearing": "Rozprawa",
    "manuscript": "Rękopis",
    "case": "Sprawa sądowa",
    "statute": "Statut",
    "webpage": "Strona WWW",
    "forumPost": "Wpis na forum",
    "blogPost": "Wpis w blogu",
    "interview": "Wywiad",
    "dataset": "Zestaw danych",
}

# Typy bez pola title — wymagany alias poniżej.
TITLE_FIELD_BY_TYPE: dict[str, str] = {
    "case": "caseName",
    "statute": "nameOfAct",
    "email": "subject",
}

# Pola wspólne (title dokładany osobno / przez alias).
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
        "citationKey",
        "archive",
        "archiveLocation",
        "libraryCatalog",
        "callNumber",
    }
)

_TYPE_FIELDS: dict[str, frozenset[str]] = {
    "journalArticle": frozenset(
        {
            "ISSN",
            "PMCID",
            "PMID",
            "issue",
            "journalAbbreviation",
            "pages",
            "partNumber",
            "partTitle",
            "place",
            "publicationTitle",
            "publisher",
            "section",
            "series",
            "seriesText",
            "seriesTitle",
            "volume",
        }
    ),
    "encyclopediaArticle": frozenset(
        {
            "ISBN",
            "edition",
            "encyclopediaTitle",
            "numberOfVolumes",
            "pages",
            "place",
            "publisher",
            "series",
            "seriesNumber",
            "volume",
        }
    ),
    "newspaperArticle": frozenset(
        {
            "ISSN",
            "edition",
            "issue",
            "pages",
            "place",
            "publicationTitle",
            "publisher",
            "section",
            "volume",
        }
    ),
    "magazineArticle": frozenset(
        {
            "ISSN",
            "issue",
            "pages",
            "place",
            "publicationTitle",
            "publisher",
            "volume",
        }
    ),
    "radioBroadcast": frozenset(
        {
            "audioRecordingFormat",
            "episodeNumber",
            "network",
            "place",
            "programTitle",
            "runningTime",
        }
    ),
    "document": frozenset(
        {
            "place",
            "publisher",
            "type",
        }
    ),
    "artwork": frozenset(
        {
            "artworkMedium",
            "artworkSize",
            "eventPlace",
        }
    ),
    "email": frozenset(
        {
            "subject",
        }
    ),
    "film": frozenset(
        {
            "distributor",
            "genre",
            "place",
            "runningTime",
            "videoRecordingFormat",
        }
    ),
    "dictionaryEntry": frozenset(
        {
            "ISBN",
            "dictionaryTitle",
            "edition",
            "numberOfVolumes",
            "pages",
            "place",
            "publisher",
            "series",
            "seriesNumber",
            "volume",
        }
    ),
    "instantMessage": frozenset(
        {
        }
    ),
    "book": frozenset(
        {
            "ISBN",
            "ISSN",
            "edition",
            "format",
            "numPages",
            "numberOfVolumes",
            "originalDate",
            "originalPlace",
            "originalPublisher",
            "place",
            "publisher",
            "series",
            "seriesNumber",
            "volume",
        }
    ),
    "letter": frozenset(
        {
            "eventPlace",
            "letterType",
        }
    ),
    "map": frozenset(
        {
            "ISBN",
            "edition",
            "mapType",
            "place",
            "publisher",
            "scale",
            "seriesTitle",
        }
    ),
    "conferencePaper": frozenset(
        {
            "ISBN",
            "ISSN",
            "conferenceName",
            "eventPlace",
            "issue",
            "numberOfVolumes",
            "pages",
            "place",
            "proceedingsTitle",
            "publisher",
            "series",
            "seriesNumber",
            "volume",
        }
    ),
    "audioRecording": frozenset(
        {
            "ISBN",
            "audioRecordingFormat",
            "label",
            "numberOfVolumes",
            "place",
            "runningTime",
            "seriesTitle",
            "volume",
        }
    ),
    "videoRecording": frozenset(
        {
            "ISBN",
            "numberOfVolumes",
            "place",
            "runningTime",
            "seriesTitle",
            "studio",
            "videoRecordingFormat",
            "volume",
        }
    ),
    "standard": frozenset(
        {
            "ISBN",
            "committee",
            "edition",
            "numPages",
            "number",
            "organization",
            "partNumber",
            "partTitle",
            "place",
            "publisher",
            "status",
            "type",
            "versionNumber",
        }
    ),
    "computerProgram": frozenset(
        {
            "ISBN",
            "company",
            "place",
            "programmingLanguage",
            "seriesTitle",
            "system",
            "versionNumber",
        }
    ),
    "patent": frozenset(
        {
            "applicationNumber",
            "assignee",
            "country",
            "filingDate",
            "issueDate",
            "issuingAuthority",
            "legalStatus",
            "pages",
            "patentNumber",
            "place",
            "priorityDate",
            "priorityNumbers",
            "references",
        }
    ),
    "podcast": frozenset(
        {
            "audioFileType",
            "episodeNumber",
            "place",
            "publisher",
            "runningTime",
            "seriesTitle",
        }
    ),
    "thesis": frozenset(
        {
            "ISBN",
            "ISSN",
            "numPages",
            "place",
            "series",
            "seriesNumber",
            "thesisType",
            "university",
        }
    ),
    "preprint": frozenset(
        {
            "archiveID",
            "genre",
            "place",
            "repository",
            "series",
            "seriesNumber",
        }
    ),
    "presentation": frozenset(
        {
            "meetingName",
            "place",
            "presentationType",
            "series",
            "sessionTitle",
        }
    ),
    "tvBroadcast": frozenset(
        {
            "episodeNumber",
            "network",
            "place",
            "programTitle",
            "runningTime",
            "videoRecordingFormat",
        }
    ),
    "bill": frozenset(
        {
            "billNumber",
            "code",
            "codePages",
            "codeVolume",
            "history",
            "legislativeBody",
            "section",
            "session",
        }
    ),
    "report": frozenset(
        {
            "ISBN",
            "ISSN",
            "institution",
            "pages",
            "place",
            "reportNumber",
            "reportType",
            "seriesNumber",
            "seriesTitle",
        }
    ),
    "bookSection": frozenset(
        {
            "ISBN",
            "ISSN",
            "bookTitle",
            "edition",
            "format",
            "numberOfVolumes",
            "originalDate",
            "originalPlace",
            "originalPublisher",
            "pages",
            "place",
            "publisher",
            "series",
            "seriesNumber",
            "volume",
        }
    ),
    "hearing": frozenset(
        {
            "committee",
            "documentNumber",
            "history",
            "legislativeBody",
            "numberOfVolumes",
            "pages",
            "place",
            "publisher",
            "session",
        }
    ),
    "manuscript": frozenset(
        {
            "institution",
            "manuscriptType",
            "numPages",
            "number",
            "place",
        }
    ),
    "case": frozenset(
        {
            "caseName",
            "court",
            "dateDecided",
            "docketNumber",
            "firstPage",
            "history",
            "reporter",
            "reporterVolume",
        }
    ),
    "statute": frozenset(
        {
            "code",
            "codeNumber",
            "dateEnacted",
            "history",
            "nameOfAct",
            "pages",
            "publicLawNumber",
            "section",
            "session",
        }
    ),
    "webpage": frozenset(
        {
            "place",
            "publisher",
            "websiteTitle",
            "websiteType",
        }
    ),
    "forumPost": frozenset(
        {
            "forumTitle",
            "postType",
        }
    ),
    "blogPost": frozenset(
        {
            "ISSN",
            "blogTitle",
            "websiteType",
        }
    ),
    "interview": frozenset(
        {
            "interviewMedium",
            "place",
            "publisher",
        }
    ),
    "dataset": frozenset(
        {
            "format",
            "identifier",
            "repository",
            "repositoryLocation",
            "type",
            "versionNumber",
        }
    ),
}

_CREATOR_TYPES: frozenset[str] = frozenset(
    {
        "artist",
        "attorneyAgent",
        "author",
        "bookAuthor",
        "cartographer",
        "castMember",
        "chair",
        "commenter",
        "composer",
        "contributor",
        "cosponsor",
        "counsel",
        "creator",
        "director",
        "editor",
        "executiveProducer",
        "guest",
        "host",
        "interviewee",
        "interviewer",
        "inventor",
        "narrator",
        "organizer",
        "originalCreator",
        "performer",
        "podcaster",
        "presenter",
        "producer",
        "programmer",
        "recipient",
        "reviewedAuthor",
        "scriptwriter",
        "seriesCreator",
        "seriesEditor",
        "sponsor",
        "translator",
        "wordsBy",
    }
)

class ManualItemValidationError(ValueError):
    """Nieprawidłowy payload ręcznej pozycji."""


def primary_title_field(item_type: str) -> str:
    return TITLE_FIELD_BY_TYPE.get(item_type, "title")


def allowed_fields_for(item_type: str) -> frozenset[str]:
    fields = set(_COMMON_FIELDS) | set(_TYPE_FIELDS.get(item_type, frozenset()))
    primary = primary_title_field(item_type)
    if primary != "title":
        fields.discard("title")
        fields.add(primary)
        # Alias: Gemini / formularz mogą wysłać title — mapujemy później.
        fields.add("title")
    return frozenset(fields)


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

    primary = primary_title_field(item_type)
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
            if key != "creators":
                raise ManualItemValidationError(f"Pole {key} musi być tekstem.")
        item[key] = str(value).strip() if isinstance(value, str) else value

    # title → alias (caseName / nameOfAct / subject)
    if primary != "title":
        if primary not in item and item.get("title"):
            item[primary] = item.pop("title")
        elif "title" in item and primary in item:
            item.pop("title", None)

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

    title = str(item.get(primary) or "").strip()
    if require_title and not title:
        raise ManualItemValidationError(f"Wymagane pole: {primary}.")

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
    primary = primary_title_field(item_type)
    ordering = ["itemType", primary, "creators", "date", "url", "abstractNote"]
    for key in sorted(properties.keys()):
        if key not in ordering:
            ordering.append(key)
    return {
        "type": "OBJECT",
        "properties": properties,
        "propertyOrdering": ordering,
    }
