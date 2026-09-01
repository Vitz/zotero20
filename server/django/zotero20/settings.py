import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "dev-only-change-me-in-production",
)

DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() in ("1", "true", "yes")

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get(
        "DJANGO_ALLOWED_HOSTS",
        "localhost,127.0.0.1,zotero.keyweb.pl,django",
    ).split(",")
    if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "captcha",
    "django_recaptcha",
    "apps.gateway",
    "apps.imports",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "apps.gateway.middleware.ApiCsrfExemptMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.gateway.middleware.ApiKeyMiddleware",
]

ROOT_URLCONF = "zotero20.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "zotero20.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "data" / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "pl-pl"
TIME_ZONE = "Europe/Warsaw"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# HTTPS za Caddy / Cloudflare — bez tego CSRF i ciasteczka sesji się psują
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

_csrf_origins = os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "")
if _csrf_origins:
    CSRF_TRUSTED_ORIGINS = [
        o.strip() for o in _csrf_origins.split(",") if o.strip()
    ]
elif not DEBUG:
    CSRF_TRUSTED_ORIGINS = [
        f"https://{host}"
        for host in ALLOWED_HOSTS
        if host not in ("localhost", "127.0.0.1", "django", "*")
    ]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "/app/login/"
LOGIN_REDIRECT_URL = "/app/"
LOGOUT_REDIRECT_URL = "/app/login/"

# --- Zotero20 gateway ---
ZOTERO_URL = os.environ.get("ZOTERO_URL", "http://127.0.0.1:23119").rstrip("/")

# Zotero Web API (zotero.org) — opcjonalnie; gdy ustawiony, kolekcje i import DOI
# idą bezpośrednio do biblioteki online (bez VNC / lokalnego Dockera).
# Akceptuje też legacy nazwy sekretów GitHub: ZOTER_API_RW / ZOTERO_API_RW.
ZOTERO_WEB_API_KEY = (
    os.environ.get("ZOTERO_WEB_API_KEY", "").strip()
    or os.environ.get("ZOTER_API_RW", "").strip()
    or os.environ.get("ZOTERO_API_RW", "").strip()
)
# Opcjonalnie; jeśli puste, Django wywoła GET /keys/{apiKey} i odczyta userID.
ZOTERO_WEB_USER_ID = os.environ.get("ZOTERO_WEB_USER_ID", "").strip()
STUDIES_CONFIG = os.environ.get(
    "STUDIES_CONFIG",
    str(BASE_DIR / "config" / "studies.yaml"),
)
API_KEY = os.environ.get("ZOTERO20_API_KEY", "")
ORCID_PUBLIC_API = "https://pub.orcid.org/v3.0"
ORCID_RATE_LIMIT_DELAY = float(os.environ.get("ORCID_RATE_LIMIT_DELAY", "0.35"))

# Ścieżki proxowane do Zotero (Connector + Local API). Import Django: /api/v1/*
ZOTERO_PROXY_PREFIXES = (
    "connector/",
    "api/users/",
    "api/plus/",
    "api/local/",
)

# Proxy do Zotero Desktop — citing protocol (execCommand) na Mikrusie bywa wolny.
ZOTERO_PROXY_TIMEOUT = int(os.environ.get("ZOTERO_PROXY_TIMEOUT", "60"))
ZOTERO_PROXY_DOCUMENT_TIMEOUT = int(
    os.environ.get("ZOTERO_PROXY_DOCUMENT_TIMEOUT", "180")
)

# --- Captcha (logowanie admin /app) ---
# none | simple | recaptcha | hcaptcha
CAPTCHA_TYPE = os.environ.get("CAPTCHA_TYPE", "simple").lower()

RECAPTCHA_PUBLIC_KEY = os.environ.get("RECAPTCHA_PUBLIC_KEY", "")
RECAPTCHA_PRIVATE_KEY = os.environ.get("RECAPTCHA_PRIVATE_KEY", "")
RECAPTCHA_REQUIRED_SCORE = float(os.environ.get("RECAPTCHA_REQUIRED_SCORE", "0.5"))

HCAPTCHA_SITEKEY = os.environ.get("HCAPTCHA_SITEKEY", "")
HCAPTCHA_SECRET = os.environ.get("HCAPTCHA_SECRET", "")

SILENCED_SYSTEM_CHECKS = []
if CAPTCHA_TYPE == "recaptcha" and not RECAPTCHA_PRIVATE_KEY:
    SILENCED_SYSTEM_CHECKS.append("django_recaptcha.recaptcha_test_key_error")

# django-recaptcha (gdy CAPTCHA_TYPE=recaptcha)
if CAPTCHA_TYPE == "recaptcha":
    RECAPTCHA_DOMAIN = os.environ.get("RECAPTCHA_DOMAIN", "www.google.com")
