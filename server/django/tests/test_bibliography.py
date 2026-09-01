import pytest

from apps.imports.services.bibliography import (
    DEFAULT_STYLE_ID,
    export_items_bibliography,
    list_styles,
    parse_bib_html,
    resolve_style_id,
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


class TestExportItemsBibliographyOrdering:
    def test_preserves_item_keys_order(self):
        class FakeClient:
            def fetch_item_bibliography(self, item_key, style, locale="pl-PL"):
                mapping = {
                    ITEM_KEY_1: '<div class="csl-entry">Entry A</div>',
                    ITEM_KEY_2: '<div class="csl-entry">Entry B</div>',
                }
                return mapping[item_key]

        payload = export_items_bibliography(
            FakeClient(),
            "local",
            [ITEM_KEY_2, ITEM_KEY_1],
            "apa",
        )
        assert payload["entries"] == ["Entry B", "Entry A"]
        assert payload["item_keys"] == [ITEM_KEY_2, ITEM_KEY_1]
        assert payload["item_count"] == 2

    def test_raises_when_all_items_missing(self):
        class FailingClient:
            def fetch_item_bibliography(self, item_key, style, locale="pl-PL"):
                raise ZoteroClientError("not found", 404)

        with pytest.raises(ZoteroClientError):
            export_items_bibliography(FailingClient(), "local", [ITEM_KEY_1], "apa")

    def test_reports_missing_keys(self):
        class PartialClient:
            def fetch_item_bibliography(self, item_key, style, locale="pl-PL"):
                if item_key == ITEM_KEY_1:
                    return '<div class="csl-entry">Only one</div>'
                raise ZoteroClientError("missing", 404)

        payload = export_items_bibliography(
            PartialClient(),
            "local",
            [ITEM_KEY_1, ITEM_KEY_2],
            "apa",
        )
        assert payload["entries"] == ["Only one"]
        assert ITEM_KEY_2 in payload["missing_item_keys"]
