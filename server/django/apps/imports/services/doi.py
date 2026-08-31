from __future__ import annotations

import requests


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

    date_parts = message.get("issued", {}).get("date-parts", [[]])
    date = ""
    if date_parts and date_parts[0]:
        date = "-".join(str(part) for part in date_parts[0])

    return {
        "itemType": "journalArticle",
        "title": title_list[0] if title_list else doi,
        "creators": creators,
        "publicationTitle": container[0] if container else "",
        "volume": str(message.get("volume", "") or ""),
        "issue": str(message.get("issue", "") or ""),
        "pages": message.get("page", "") or "",
        "date": date,
        "ISSN": (message.get("ISSN") or [""])[0],
    }
