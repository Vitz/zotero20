from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("collections", views.collections_list, name="collections"),
    path("studies", views.studies_list, name="studies"),
    path("import/doi", views.import_doi, name="import-doi"),
    path("import/orcid", views.import_orcid, name="import-orcid"),
    path("collection-items", views.collection_items, name="collection-items"),
    path(
        "collections/<str:collection_key>/items/<str:item_key>",
        views.collection_item_remove,
        name="collection-item-remove",
    ),
    path("styles", views.styles_list, name="styles"),
    path("bibliography", views.bibliography_generate, name="bibliography"),
    path("citations", views.citations_generate, name="citations"),
    path("items/<str:item_key>", views.item_detail, name="item-detail"),
    path("debug/health", views.debug_health, name="debug-health"),
    path("debug/item/<str:item_key>", views.debug_item, name="debug-item"),
    path("debug/citations", views.debug_citations, name="debug-citations"),
    path("debug/styles", views.debug_styles, name="debug-styles"),
    path("debug/echo", views.debug_echo, name="debug-echo"),
]
