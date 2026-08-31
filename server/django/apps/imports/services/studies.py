from __future__ import annotations

from pathlib import Path

import yaml
from django.conf import settings


class StudiesConfigError(Exception):
    pass


def load_studies() -> dict:
    path = Path(settings.STUDIES_CONFIG)
    if not path.exists():
        raise StudiesConfigError(
            f"Brak pliku konfiguracji badań: {path}. "
            "Skopiuj config/studies.yaml.example do config/studies.yaml."
        )
    if path.is_dir():
        raise StudiesConfigError(
            f"{path} jest katalogiem, a powinien być plikiem YAML. "
            "Usuń katalog i utwórz plik: cp config/studies.yaml.example config/studies.yaml"
        )

    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    studies = data.get("studies")
    if studies is None:
        if data and not isinstance(data, dict):
            raise StudiesConfigError("Plik studies.yaml ma nieprawidłowy format.")
        raise StudiesConfigError(
            "Plik studies.yaml nie zawiera sekcji 'studies:'. "
            "Użyj struktury jak w studies.yaml.example (studies → slug → label, collection_key)."
        )
    if not studies:
        raise StudiesConfigError(
            "Sekcja 'studies' w studies.yaml jest pusta. Dodaj co najmniej jedno badanie."
        )

    return studies


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
        raise StudiesConfigError(
            f"Badanie '{study_slug}' nie ma ustawionego collection_key w studies.yaml."
        )
    return key


def list_studies() -> list[dict]:
    studies = load_studies()
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
