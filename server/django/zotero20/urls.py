from django.contrib import admin
from django.urls import include, path, re_path

from apps.gateway.admin_site import admin_site
from apps.gateway.views import zotero_proxy
from apps.imports.views import cite_item

urlpatterns = [
    path("app/", admin_site.urls),
    path("captcha/", include("captcha.urls")),
    path("cite/<str:item_key>", cite_item, name="cite-item"),
    path("cite/<str:item_key>/", cite_item, name="cite-item-slash"),
    path("api/v1/", include("apps.imports.urls")),
    re_path(r"^(?P<zotero_path>connector/.*)$", zotero_proxy, name="zotero-proxy-connector"),
    re_path(r"^(?P<zotero_path>api/users/.*)$", zotero_proxy, name="zotero-proxy-users"),
    re_path(r"^(?P<zotero_path>api/plus/.*)$", zotero_proxy, name="zotero-proxy-plus"),
    re_path(r"^(?P<zotero_path>api/local/.*)$", zotero_proxy, name="zotero-proxy-local"),
]

# Ukryj domyślny /admin/
admin.site.site_header = "Zotero20"
