from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("studies", views.studies_list, name="studies"),
    path("import/doi", views.import_doi, name="import-doi"),
    path("import/orcid", views.import_orcid, name="import-orcid"),
]
