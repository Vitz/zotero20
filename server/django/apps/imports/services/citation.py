def format_citation_text(data: dict) -> str:
    """Prosty tekst cytowania (autor, rok) do wstawienia zamiast placeholdera."""
    creators = data.get("creators") or []
    date = str(data.get("date") or "")
    year = date[:4] if len(date) >= 4 and date[:4].isdigit() else ""

    author = ""
    if creators:
        first = creators[0]
        author = first.get("lastName") or first.get("name") or ""
        if not author and first.get("firstName"):
            author = first["firstName"]

    if author and year:
        return f"({author}, {year})"
    if author:
        return f"({author})"
    title = (data.get("title") or "").strip()
    if title:
        return f"({title[:60]}{'…' if len(title) > 60 else ''})"
    return "(?)"
