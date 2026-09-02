import pytest

from apps.imports.services.bibliography import (
    DEFAULT_STYLE_ID,
    build_document_citations,
    export_items_bibliography,
    is_numeric_style,
    list_styles,
    parse_bib_html,
    parse_formatted_items,
    resolve_style_id,
    strip_leading_number,
    style_label,
)
from apps.imports.services.exceptions import ZoteroClientError
from tests.constants import ITEM_KEY_1, ITEM_KEY_2


class TestResolveStyleId:
    def test_default_style(self):
        assert resolve_style_id(None) == DEFAULT_STYLE_ID
        assert resolve_style_id("") == DEFAULT_STYLE_ID

    def test_known_style(self):
        assert resolve_style_id("ieee") == "ieee"
        assert resolve_style_id("APA") == "apa"

    def test_csl_url_style(self):
        url = "https://www.zotero.org/styles/vancouver"
        assert resolve_style_id(url) == "vancouver"

    def test_unknown_style_raises(self):
        with pytest.raises(ValueError, match="Nieobsługiwany styl"):
            resolve_style_id("unknown-style-xyz")


class TestStyleLabel:
    def test_known_label(self):
        assert style_label("apa") == "APA 7th edition"

    def test_unknown_returns_id(self):
        assert style_label("custom") == "custom"


class TestListStyles:
    def test_returns_copy(self):
        styles = list_styles()
        assert len(styles) >= 5
        assert styles[0]["id"] == "apa"


class TestParseBibHtml:
    def test_parses_csl_entry_divs(self):
        html = """
        <div class="csl-bib-body">
          <div class="csl-entry">First entry.</div>
          <div class="csl-entry">Second entry.</div>
        </div>
        """
        entries = parse_bib_html(html)
        assert entries == ["First entry.", "Second entry."]

    def test_unescapes_html_entities(self):
        html = '<div class="csl-entry">Smith &amp; Jones (2020).</div>'
        assert parse_bib_html(html) == ["Smith & Jones (2020)."]

    def test_empty_returns_empty_list(self):
        assert parse_bib_html("") == []
        assert parse_bib_html("   ") == []

    def test_fallback_strips_tags(self):
        html = "<p>Plain line one</p><p>Plain line two</p>"
        entries = parse_bib_html(html)
        assert "Plain line one" in entries[0]
        assert len(entries) >= 1


class FakeBibClient:
    """Klient bez zbiorczego endpointu — wymusza ścieżkę zapytań pojedynczych."""

    def __init__(self, mapping=None, citations=None):
        self.mapping = (
            {
                ITEM_KEY_1: "Smith, J. (2013). Entry A.",
                ITEM_KEY_2: "Kowalski, A. (2020). Entry B.",
            }
            if mapping is None
            else mapping
        )
        self.citations = (
            {
                ITEM_KEY_1: "(Smith, 2013)",
                ITEM_KEY_2: "(Kowalski, 2020)",
            }
            if citations is None
            else citations
        )

    def fetch_item_bibliography(self, item_key, style, locale="pl-PL"):
        if item_key not in self.mapping:
            raise ZoteroClientError("missing", 404)
        return f'<div class="csl-entry">{self.mapping[item_key]}</div>'

    def fetch_item_citation(self, item_key, style, locale="pl-PL"):
        return self.citations.get(item_key, "")


class TestExportItemsBibliographyOrdering:
    def test_author_date_style_sorts_alphabetically(self):
        payload = export_items_bibliography(
            FakeBibClient(),
            "local",
            [ITEM_KEY_1, ITEM_KEY_2],
            "apa",
        )
        assert payload["entries"] == [
            "Kowalski, A. (2020). Entry B.",
            "Smith, J. (2013). Entry A.",
        ]
        assert payload["item_keys"] == [ITEM_KEY_1, ITEM_KEY_2]
        assert payload["item_count"] == 2
        assert "citations" not in payload

    def test_raises_when_all_items_missing(self):
        with pytest.raises(ZoteroClientError):
            export_items_bibliography(FakeBibClient(mapping={}), "local", [ITEM_KEY_1], "apa")

    def test_reports_missing_keys(self):
        client = FakeBibClient(mapping={ITEM_KEY_1: "Only one"})
        payload = export_items_bibliography(
            client,
            "local",
            [ITEM_KEY_1, ITEM_KEY_2],
            "apa",
        )
        assert payload["entries"] == ["Only one"]
        assert ITEM_KEY_2 in payload["missing_item_keys"]

    def test_empty_item_keys_raises(self):
        with pytest.raises(ValueError):
            export_items_bibliography(FakeBibClient(), "local", ["", "  "], "apa")


class TestBuildDocumentCitations:
    def test_numeric_style_numbers_by_citation_order(self):
        payload = build_document_citations(
            FakeBibClient(),
            "local",
            [ITEM_KEY_2, ITEM_KEY_1],
            "ieee",
        )
        assert payload["numeric"] is True
        assert payload["citations"] == [
            {"item_key": ITEM_KEY_2, "citation_text": "[1]"},
            {"item_key": ITEM_KEY_1, "citation_text": "[2]"},
        ]
        assert payload["entries"] == [
            "[1] Kowalski, A. (2020). Entry B.",
            "[2] Smith, J. (2013). Entry A.",
        ]

    def test_numeric_style_renumbers_zotero_per_item_numbering(self):
        client = FakeBibClient(
            mapping={
                ITEM_KEY_1: "[1] Smith, J. (2013). Entry A.",
                ITEM_KEY_2: "[1] Kowalski, A. (2020). Entry B.",
            }
        )
        payload = build_document_citations(client, "local", [ITEM_KEY_1, ITEM_KEY_2], "vancouver")
        assert payload["entries"] == [
            "[1] Smith, J. (2013). Entry A.",
            "[2] Kowalski, A. (2020). Entry B.",
        ]

    def test_author_date_citations_follow_document_order(self):
        payload = build_document_citations(
            FakeBibClient(),
            "local",
            [ITEM_KEY_2, ITEM_KEY_1],
            "apa",
        )
        assert payload["numeric"] is False
        assert [c["item_key"] for c in payload["citations"]] == [ITEM_KEY_2, ITEM_KEY_1]
        assert payload["citations"][0]["citation_text"] == "(Kowalski, 2020)"
        assert payload["entries"][0].startswith("Kowalski")

    def test_deduplicates_repeated_citations(self):
        payload = build_document_citations(
            FakeBibClient(),
            "local",
            [ITEM_KEY_1, ITEM_KEY_2, ITEM_KEY_1],
            "ieee",
        )
        assert payload["item_keys"] == [ITEM_KEY_1, ITEM_KEY_2]
        assert len(payload["entries"]) == 2

    def test_uses_batch_endpoint_when_available(self):
        class BatchClient(FakeBibClient):
            def __init__(self):
                super().__init__()
                self.batch_calls = 0
                self.single_calls = 0

            def fetch_items_formatted(self, item_keys, style, locale="pl-PL"):
                self.batch_calls += 1
                return {
                    key: {"bib": self.mapping[key], "citation": self.citations[key]}
                    for key in item_keys
                    if key in self.mapping
                }

            def fetch_item_bibliography(self, item_key, style, locale="pl-PL"):
                self.single_calls += 1
                return super().fetch_item_bibliography(item_key, style, locale)

        client = BatchClient()
        payload = build_document_citations(client, "local", [ITEM_KEY_1, ITEM_KEY_2], "apa")
        assert client.batch_calls == 1
        assert client.single_calls == 0
        assert len(payload["entries"]) == 2

    def test_falls_back_to_single_requests_when_batch_fails(self):
        class BrokenBatchClient(FakeBibClient):
            def fetch_items_formatted(self, item_keys, style, locale="pl-PL"):
                raise ZoteroClientError("batch not supported", 400)

        payload = build_document_citations(
            BrokenBatchClient(),
            "local",
            [ITEM_KEY_1, ITEM_KEY_2],
            "apa",
        )
        assert len(payload["entries"]) == 2


class TestStripLeadingNumber:
    @pytest.mark.parametrize(
        "raw",
        ["[12] Smith, J.", "(3) Smith, J.", "7. Smith, J.", "7) Smith, J.", "Smith, J."],
    )
    def test_removes_leading_numbering(self, raw):
        assert strip_leading_number(raw) == "Smith, J."


class TestParseFormattedItems:
    def test_maps_keys_to_bib_and_citation(self):
        raw = [
            {
                "key": ITEM_KEY_1,
                "bib": '<div class="csl-bib-body"><div class="csl-entry">Smith.</div></div>',
                "citation": '<span class="citation">(Smith, 2013)</span>',
            },
            {"key": "OTHERKEY", "bib": '<div class="csl-entry">Ignored.</div>'},
        ]
        parsed = parse_formatted_items(raw, [ITEM_KEY_1])
        assert parsed == {ITEM_KEY_1: {"bib": "Smith.", "citation": "(Smith, 2013)"}}

    def test_ignores_non_list_payload(self):
        assert parse_formatted_items({"key": ITEM_KEY_1}, [ITEM_KEY_1]) == {}


class TestIsNumericStyle:
    def test_numeric_styles(self):
        assert is_numeric_style("ieee")
        assert is_numeric_style("vancouver")

    def test_author_date_styles(self):
        assert not is_numeric_style("apa")
        assert not is_numeric_style("chicago-author-date")
