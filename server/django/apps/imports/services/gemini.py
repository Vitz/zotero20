"""Klient Google Gemini (REST) — uzupełnianie pól pozycji z tekstu (bez zapisu do Zotero)."""

from __future__ import annotations

import logging
import time
from typing import Any

import requests
from django.conf import settings

from .manual_item import (
    ManualItemValidationError,
    gemini_response_schema,
    validate_and_normalize_item,
)

logger = logging.getLogger(__name__)

# Free-tier friendly; override via GEMINI_MODEL.
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
MAX_TEXT_LENGTH = 12_000

_SYSTEM_PROMPT = (
    "Jesteś asystentem bibliograficznym. Na podstawie podanego tekstu wypełnij "
    "metadane pozycji w formacie Zotero (JSON). "
    "Wypełniaj TYLKO pola, które wynikają wprost z tekstu. "
    "NIE wymyślaj DOI, ISBN ani URL — jeśli nie ma ich w tekście, zostaw puste. "
    "Nie zmieniaj itemType na inny niż podany. "
    "Nieznane wartości = pusty string. Autorów rozbij na firstName/lastName gdy to możliwe."
)

# Prosty limity w pamięci procesu (per klucz = IP lub "global").
_RATE_BUCKETS: dict[str, list[float]] = {}
_RATE_MAX_CALLS = 20
_RATE_WINDOW_SEC = 3600


class GeminiError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def gemini_configured(api_key: str | None = None) -> bool:
    """True jeśli jest klucz z żądania albo opcjonalny GEMINI_API_KEY w env."""
    return bool(resolve_gemini_api_key(api_key))


def resolve_gemini_api_key(api_key: str | None = None) -> str:
    """
    Preferuj klucz z żądania (sidebar / X-Gemini-Api-Key), inaczej env.
    Nie loguj wartości klucza.
    """
    candidate = (api_key or "").strip()
    if candidate:
        return candidate
    return (getattr(settings, "GEMINI_API_KEY", "") or "").strip()


def get_gemini_model() -> str:
    return (getattr(settings, "GEMINI_MODEL", "") or DEFAULT_GEMINI_MODEL).strip()


def _check_rate_limit(bucket_key: str) -> None:
    now = time.time()
    window_start = now - _RATE_WINDOW_SEC
    stamps = [t for t in _RATE_BUCKETS.get(bucket_key, []) if t >= window_start]
    if len(stamps) >= _RATE_MAX_CALLS:
        raise GeminiError(
            "Limit zapytań Gemini wyczerpany (max 20/h). Spróbuj później lub wypełnij pola ręcznie.",
            status_code=429,
        )
    stamps.append(now)
    _RATE_BUCKETS[bucket_key] = stamps


def describe_item_from_text(
    *,
    item_type: str,
    text: str,
    rate_key: str = "global",
    api_key: str | None = None,
) -> dict[str, Any]:
    """
    Wywołuje Gemini → draft JSON (bez zapisu do Zotero).
    Zwraca {"draft": {...}, "warnings": [...], "model": "..."}.
    api_key: opcjonalny klucz z nagłówka/body; inaczej settings.GEMINI_API_KEY.
    """
    resolved_key = resolve_gemini_api_key(api_key)
    if not resolved_key:
        raise GeminiError(
            "Brak klucza Gemini — ustaw w Ustawieniach",
            status_code=503,
        )

    text = (text or "").strip()
    if not text:
        raise GeminiError("Wymagane pole: text.", status_code=400)
    if len(text) > MAX_TEXT_LENGTH:
        raise GeminiError(
            f"Tekst jest za długi (max {MAX_TEXT_LENGTH} znaków).",
            status_code=400,
        )

    try:
        schema = gemini_response_schema(item_type)
    except ManualItemValidationError as exc:
        raise GeminiError(str(exc), status_code=400) from exc

    _check_rate_limit(rate_key or "global")

    model = get_gemini_model()
    url = f"{GEMINI_API_BASE}/models/{model}:generateContent"

    user_prompt = (
        f"itemType: {item_type}\n\n"
        f"Tekst źródłowy:\n---\n{text}\n---\n"
        "Zwróć jeden obiekt JSON z polami pozycji Zotero."
    )

    body = {
        "systemInstruction": {"parts": [{"text": _SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }

    # Cloudflare Free kończy proxy ~100s (524/520). Trzymaj zapas pod Caddy+Gunicorn.
    try:
        response = requests.post(
            url,
            params={"key": resolved_key},
            json=body,
            timeout=45,
        )
    except requests.RequestException as exc:
        logger.warning("Gemini HTTP error: %s", type(exc).__name__)
        raise GeminiError(f"Błąd połączenia z Gemini: {exc}", status_code=502) from exc

    if response.status_code == 429:
        raise GeminiError(
            "Gemini zwróciło limit zapytań (429). Spróbuj później.",
            status_code=429,
        )
    if response.status_code >= 400:
        detail = (response.text or "")[:300]
        logger.warning("Gemini API HTTP %s (model=%s)", response.status_code, model)
        raise GeminiError(
            f"Gemini API błąd HTTP {response.status_code}: {detail}",
            status_code=502,
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise GeminiError("Nieprawidłowa odpowiedź Gemini (nie-JSON).", status_code=502) from exc

    raw_text = _extract_text(payload)
    if not raw_text:
        raise GeminiError("Gemini nie zwróciło treści.", status_code=502)

    try:
        import json

        draft_raw = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise GeminiError("Gemini zwróciło nieparsowalny JSON.", status_code=502) from exc

    if not isinstance(draft_raw, dict):
        raise GeminiError("Draft Gemini nie jest obiektem JSON.", status_code=502)

    # Wymuś itemType z żądania (model nie może go zmienić).
    draft_raw["itemType"] = item_type
    warnings: list[str] = []

    # Placeholder collection — describe nie zapisuje; walidacja pól bez wymagania kolekcji.
    try:
        draft = validate_and_normalize_item(
            draft_raw,
            collection_key="PLACEHLD",  # 8 znaków; usuniemy collections z draftu
            require_title=False,
        )
    except ManualItemValidationError as exc:
        warnings.append(str(exc))
        # Best-effort: zostaw surowy draft po stripie znanych pól.
        draft = {"itemType": item_type}
        for key, value in draft_raw.items():
            if key in ("itemType", "collections", "collection_key"):
                continue
            if value not in ("", None, [], {}):
                draft[key] = value

    draft.pop("collections", None)
    if not str(draft.get("title") or "").strip():
        warnings.append("Brak tytułu w odpowiedzi modelu — uzupełnij ręcznie.")

    logger.info(
        "Gemini describe ok model=%s itemType=%s text_len=%s warnings=%s",
        model,
        item_type,
        len(text),
        len(warnings),
    )
    return {"draft": draft, "warnings": warnings, "model": model}


def _extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    chunks = []
    for part in parts:
        if isinstance(part, dict) and part.get("text"):
            chunks.append(str(part["text"]))
    return "".join(chunks).strip()
