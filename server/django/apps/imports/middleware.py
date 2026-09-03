import json
import re
from functools import wraps

from django.http import JsonResponse


def json_api(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if request.method not in ("GET", "POST", "DELETE", "OPTIONS"):
            return JsonResponse({"error": "Metoda niedozwolona."}, status=405)
        return view_func(request, *args, **kwargs)

    return wrapper


def parse_json_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


DOI_RE = re.compile(
    r"^(?:https?://(?:dx\.)?doi\.org/)?(?:doi:)?(10\.\d+/\S+)$",
    re.IGNORECASE,
)

ORCID_RE = re.compile(
    r"^(?:https?://orcid\.org/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$",
    re.IGNORECASE,
)


def normalize_doi(value: str) -> str | None:
    value = value.strip()
    match = DOI_RE.match(value)
    if match:
        return match.group(1)
    if value.lower().startswith("10."):
        return value
    return None


def normalize_orcid(value: str) -> str | None:
    value = value.strip()
    match = ORCID_RE.match(value)
    if match:
        return match.group(1)
    cleaned = value.replace("https://orcid.org/", "").strip()
    match = ORCID_RE.match(cleaned)
    if match:
        return match.group(1)
    return None


def extract_item_orcid(data: dict) -> str:
    """ORCID pierwszego autora z creators[].ORCID lub pola extra."""
    creators = data.get("creators") or []
    if isinstance(creators, list):
        for creator in creators:
            if not isinstance(creator, dict):
                continue
            for key in ("ORCID", "orcid", "Orcid"):
                raw = creator.get(key)
                if not raw:
                    continue
                oid = normalize_orcid(str(raw))
                if oid:
                    return oid
    extra = str(data.get("extra") or "")
    for line in extra.splitlines():
        line = line.strip()
        if not line:
            continue
        if ":" in line:
            label, _, rest = line.partition(":")
            if label.strip().lower() != "orcid":
                continue
            oid = normalize_orcid(rest.strip())
            if oid:
                return oid
        else:
            oid = normalize_orcid(line)
            if oid:
                return oid
    return ""
