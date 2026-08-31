from __future__ import annotations

import logging

import requests
from django import forms
from django.conf import settings
from django.contrib.auth.forms import AuthenticationForm
from django.core.exceptions import ValidationError
from captcha.fields import CaptchaField

logger = logging.getLogger(__name__)


class HcaptchaField(forms.CharField):
    """Weryfikacja hCaptcha po stronie serwera."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("label", "")
        kwargs.setdefault(
            "widget",
            forms.HiddenInput(attrs={"class": "h-captcha-response"}),
        )
        super().__init__(*args, **kwargs)

    def validate(self, value):
        super().validate(value)
        if not value:
            raise ValidationError("Potwierdź captcha.")
        if not settings.HCAPTCHA_SECRET:
            if settings.DEBUG:
                return
            raise ValidationError("hCaptcha nie skonfigurowane.")
        try:
            resp = requests.post(
                "https://hcaptcha.com/siteverify",
                data={"secret": settings.HCAPTCHA_SECRET, "response": value},
                timeout=10,
            )
            data = resp.json()
        except requests.RequestException as exc:
            logger.exception("hCaptcha verify failed")
            raise ValidationError("Błąd weryfikacji captcha.") from exc
        if not data.get("success"):
            raise ValidationError("Nieprawidłowa captcha.")


class AdminLoginForm(AuthenticationForm):
  """Logowanie admin /app — honeypot + captcha (CAPTCHA_TYPE w settings)."""

  HONEYPOT_FIELD = "website_url"

  def __init__(self, request=None, *args, **kwargs):
      super().__init__(request, *args, **kwargs)

      self.fields[self.HONEYPOT_FIELD] = forms.CharField(
          required=False,
          label="",
          widget=forms.TextInput(
              attrs={
                  "autocomplete": "off",
                  "tabindex": "-1",
                  "aria-hidden": "true",
                  "style": "position:absolute;left:-9999px;height:0;width:0;",
              }
          ),
      )

      captcha_type = settings.CAPTCHA_TYPE
      if captcha_type == "simple":
          self.fields["captcha"] = CaptchaField(label="Kod z obrazka")
      elif captcha_type == "recaptcha":
          from django_recaptcha.fields import ReCaptchaField
          from django_recaptcha.widgets import ReCaptchaV2Checkbox

          self.fields["captcha"] = ReCaptchaField(
              widget=ReCaptchaV2Checkbox,
              label="",
          )
      elif captcha_type == "hcaptcha":
          self.fields["captcha"] = HcaptchaField()

  def clean(self):
      cleaned = super().clean()
      if self.data.get(self.HONEYPOT_FIELD):
          logger.warning("Honeypot triggered on admin login")
          raise ValidationError("Logowanie odrzucone.")
      return cleaned
