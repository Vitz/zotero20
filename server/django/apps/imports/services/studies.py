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

    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    studies = data.get("studies") or {}
    if not studies:
        raise StudiesConfigError("Plik studies.yaml nie zawiera sekcji 'studies'.")

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
    return [
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
