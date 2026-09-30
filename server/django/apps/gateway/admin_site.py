from django.conf import settings
from django.contrib import admin
from django.contrib.auth.models import Group, User

from .forms import AdminLoginForm


class Zotero20AdminSite(admin.AdminSite):
    site_header = "Zotero20"
    site_title = "Zotero20"
    index_title = "Panel administracyjny"
    login_form = AdminLoginForm
    login_template = "admin/login.html"

    def each_context(self, request):
        context = super().each_context(request)
        context["captcha_type"] = settings.CAPTCHA_TYPE
        context["hcaptcha_sitekey"] = settings.HCAPTCHA_SITEKEY
        return context


admin_site = Zotero20AdminSite(name="zotero20_admin")
admin_site.register(User)
admin_site.register(Group)
