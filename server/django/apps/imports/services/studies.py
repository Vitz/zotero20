from __future__ import annotations

import re
from pathlib import Path

import yaml
from django.conf import settings


class StudiesConfigError(Exception):
    pass


_COLLECTION_KEY_HINT = (
    "Podaj 8-znakowy klucz kolekcji Zotero (pole \"key\" z Local API), "
    "nie nazwę folderu. Lista kolekcji: GET /api/v1/collections"
)

_COLLECTION_KEY_RE = re.compile(r"^[A-Za-z0-9]{8}$")


def is_valid_collection_key(key: str) -> bool:
    return bool(key and _COLLECTION_KEY_RE.match(key))


def try_load_studies() -> dict:
    path = Path(settings.STUDIES_CONFIG)
    if not path.exists() or path.is_dir():
        return {}

    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    studies = data.get("studies")
    if studies is None:
        if data and not isinstance(data, dict):
            raise StudiesConfigError("Plik studies.yaml ma nieprawidłowy format.")
        return {}
    if not isinstance(studies, dict):
        raise StudiesConfigError("Sekcja 'studies' w studies.yaml musi być mapą slug → wpis.")

    return studies


def load_studies() -> dict:
    studies = try_load_studies()
    if studies:
        return studies

    path = Path(settings.STUDIES_CONFIG)
    if not path.exists():
        raise StudiesConfigError(
            f"Brak pliku konfiguracji badań: {path}. "
            "Dla pojedynczego użytkownika wystarczy collection_key w sidebarze; "
            "studies.yaml jest opcjonalny (dla wielu badań)."
        )
    if path.is_dir():
        raise StudiesConfigError(
            f"{path} jest katalogiem, a powinien być plikiem YAML. "
            "Usuń katalog i utwórz plik: cp config/studies.yaml.example config/studies.yaml"
        )

    raise StudiesConfigError(
        "Plik studies.yaml nie zawiera sekcji 'studies:'. "
        "Użyj struktury jak w studies.yaml.example (studies → slug → label, collection_key) "
        "albo importuj przez collection_key z panelu bocznego."
    )


def get_collection_key(study_slug: str) -> str:
    studies = load_studies()
    entry = studies.get(study_slug)
    if not entry:
        known = ", ".join(sorted(studies))
        raise StudiesConfigError(
            f"Nieznane badanie '{study_slug}'. Dostępne: {known or '(brak)'}"
        )

    key = entry.get("collection_key", "")
    if not key or key.startswith("REPLACE_"):
        label = entry.get("label", study_slug)
        raise StudiesConfigError(
            f"Badanie '{study_slug}' ({label}) nie ma ustawionego collection_key "
            f"w studies.yaml. {_COLLECTION_KEY_HINT}"
        )
    return key


def resolve_collection_key(
    *,
    study: str = "",
    collection_key: str = "",
) -> tuple[str, str | None]:
    study = (study or "").strip()
    collection_key = (collection_key or "").strip()

    if collection_key and study:
        raise StudiesConfigError("Podaj study albo collection_key, nie oba naraz.")

    if collection_key:
        if not is_valid_collection_key(collection_key):
            raise StudiesConfigError(
                f"Nieprawidłowy collection_key '{collection_key}'. "
                f"Oczekiwany 8-znakowy klucz Zotero. {_COLLECTION_KEY_HINT}"
            )
        return collection_key, None

    if study:
        return get_collection_key(study), study

    raise StudiesConfigError(
        "Wymagane pole: collection_key (z panelu bocznego) lub study (z studies.yaml)."
    )


def list_studies() -> list[dict]:
    studies = try_load_studies()
    items = [
        {
            "slug": slug,
            "label": entry.get("label", slug),
            "collection_key": entry.get("collection_key", ""),
            "configured": bool(
                entry.get("collection_key")
                and not str(entry.get("collection_key", "")).startswith("REPLACE_")
            ),
        }
        for slug, entry in studies.items()
    ]
    items.sort(key=lambda item: item["label"].lower())
    return items
