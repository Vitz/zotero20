FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data /app/config

ENV PYTHONUNBUFFERED=1
ENV DJANGO_SETTINGS_MODULE=zotero20.settings

EXPOSE 8000

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
# 1 worker domyślnie (Mikrus 1.2GB RAM); nadpisz GUNICORN_WORKERS w .env
CMD ["gunicorn"]
