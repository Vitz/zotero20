from __future__ import annotations

from .bibliography import (
    build_document_citations,
    dedupe_item_keys,
    is_numeric_style,
    resolve_style_id,
    style_label,
)
from .exceptions import ZoteroClientError


def _trace_fetch_formatted(client, item_keys: list[str], style_id: str) -> tuple[dict, list[dict]]:
    """Pobiera sformatowane pozycje i zapisuje kroki diagnostyczne."""
    trace: list[dict] = []
    formatted: dict[str, dict[str, str]] = {}

    batch = getattr(client, "fetch_items_formatted", None)
    if batch is not None:
        try:
            raw = batch(item_keys, style_id) or {}
            trace.append(
                {
                    "step": "batch_fetch_items_formatted",
                    "ok": True,
                    "requested": len(item_keys),
                    "returned": len(raw),
                }
            )
            for key, value in raw.items():
                entry = (value or {}).get("bib", "").strip()
                if entry:
                    formatted[key] = {
                        "bib": entry,
                        "citation": (value or {}).get("citation", "").strip(),
                    }
        except Exception as exc:  # noqa: BLE001
            trace.append(
                {
                    "step": "batch_fetch_items_formatted",
                    "ok": False,
                    "error": str(exc),
                }
            )
    else:
        trace.append({"step": "batch_fetch_items_formatted", "ok": False, "skipped": "not_supported"})

    missing: list[str] = []
    for item_key in item_keys:
        if item_key in formatted:
            continue
        step = {"step": "single_item_bibliography", "item_key": item_key}
        try:
            bib_html = client.fetch_item_bibliography(item_key, style_id)
            from .bibliography import parse_bib_html

            parsed = [entry for entry in parse_bib_html(bib_html) if entry.strip()]
            if parsed:
                formatted[item_key] = {"bib": parsed[0], "citation": ""}
                step["ok"] = True
            else:
                step["ok"] = False
                step["error"] = "empty_bib"
                missing.append(item_key)
        except ZoteroClientError as exc:
            step["ok"] = False
            step["error"] = str(exc)
            missing.append(item_key)
        trace.append(step)

    return formatted, trace


def trace_item_citation(client, item_key: str, style: str | None = None) -> list[dict]:
    """Próbuje pobrać cytowanie każdą dostępną ścieżką (do debug/item)."""
    steps: list[dict] = []
    resolved = resolve_style_id(style) if style else None

    if resolved:
        fetch = getattr(client, "fetch_item_citation", None)
        if fetch:
            try:
                text = (fetch(item_key, resolved) or "").strip()
                steps.append(
                    {
                        "method": "fetch_item_citation",
                        "style": resolved,
                        "ok": bool(text),
                        "citation_text": text,
                    }
                )
            except ZoteroClientError as exc:
                steps.append(
                    {
                        "method": "fetch_item_citation",
                        "style": resolved,
                        "ok": False,
                        "error": str(exc),
                    }
                )
        else:
            steps.append({"method": "fetch_item_citation", "ok": False, "skipped": "not_supported"})

        formatted, fmt_trace = _trace_fetch_formatted(client, [item_key], resolved)
        steps.append({"method": "formatted_batch", "trace": fmt_trace, "formatted": formatted})
        if item_key in formatted and formatted[item_key].get("citation"):
            steps.append(
                {
                    "method": "formatted_citation",
                    "ok": True,
                    "citation_text": formatted[item_key]["citation"],
                }
            )

    try:
        item = client.get_item(item_key)
        steps.append({"method": "get_item", "ok": item is not None, "item": item})
    except ZoteroClientError as exc:
        steps.append({"method": "get_item", "ok": False, "error": str(exc)})

    return steps


def build_document_citations_debug(client, source: str, item_keys: list[str], style_id: str) -> dict:
    """Jak build_document_citations, ale z polem trace (ścieżka kodu + podsumowanie)."""
    resolved = resolve_style_id(style_id)
    ordered = dedupe_item_keys(item_keys)
    numeric = is_numeric_style(resolved)

    trace: list[dict] = [
        {
            "step": "resolve_style",
            "style": resolved,
            "style_label": style_label(resolved),
            "numeric": numeric,
        },
        {"step": "dedupe_item_keys", "input_count": len(item_keys or []), "keys": ordered},
    ]

    payload = build_document_citations(client, source, item_keys, style_id)
    trace.append(
        {
            "step": "build_document_citations",
            "item_count": payload.get("item_count"),
            "missing_item_keys": payload.get("missing_item_keys", []),
        }
    )
    payload["trace"] = trace
    payload["code_path"] = "numeric_renumber" if numeric else "author_date_sorted_bibliography"
    return payload


def dedupe_collection_items_by_doi(items: list[dict]) -> tuple[list[dict], int]:
    """Usuwa duplikaty DOI z listy (zachowuje pierwszą = najnowszą wg sortowania API)."""
    seen: set[str] = set()
    deduped: list[dict] = []
    hidden = 0
    for item in items:
        doi = (item.get("doi") or "").strip().lower()
        if doi:
            if doi in seen:
                hidden += 1
                continue
            seen.add(doi)
        deduped.append(item)
    return deduped, hidden
