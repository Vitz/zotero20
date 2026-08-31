import json
import re
from functools import wraps

from django.http import JsonResponse


def json_api(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if request.method not in ("GET", "POST", "OPTIONS"):
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
    r"^(?:https?://(?:dx\.)?doi\.org/)?(?:doi:)?(10\.\d{4,9}/\S+)$",
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
