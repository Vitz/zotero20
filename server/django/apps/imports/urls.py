from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("collections", views.collections_list, name="collections"),
    path("studies", views.studies_list, name="studies"),
    path("import/doi", views.import_doi, name="import-doi"),
    path("import/orcid", views.import_orcid, name="import-orcid"),
    path("collection-items", views.collection_items, name="collection-items"),
    path("styles", views.styles_list, name="styles"),
    path("bibliography", views.bibliography_generate, name="bibliography"),
    path("items/<str:item_key>", views.item_detail, name="item-detail"),
]
