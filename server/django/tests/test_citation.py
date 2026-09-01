from apps.imports.services.citation import format_citation_text, parse_citation_html


class TestParseCitationHtml:
    def test_strips_tags(self):
        html = '<span class="citation">(Smith, 2013)</span>'
        assert parse_citation_html(html) == "(Smith, 2013)"

    def test_empty_input(self):
        assert parse_citation_html("") == ""
        assert parse_citation_html("  ") == ""


class TestFormatCitationText:
    def test_author_and_year(self):
        data = {
            "creators": [{"lastName": "Smith", "firstName": "John"}],
            "date": "2013-08-14",
        }
        assert format_citation_text(data) == "(Smith, 2013)"

    def test_author_only(self):
        data = {"creators": [{"lastName": "Nowak"}], "date": ""}
        assert format_citation_text(data) == "(Nowak)"

    def test_title_fallback(self):
        data = {"title": "A Very Long Title That Should Be Truncated Somewhere", "date": ""}
        text = format_citation_text(data)
        assert text.startswith("(")
        assert "…" in text or len(text) < 70

    def test_unknown_fallback(self):
        assert format_citation_text({}) == "(?)"
