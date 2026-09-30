# syntax=docker/dockerfile:1

FROM debian:bookworm-slim

ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl bzip2 xz-utils dbus-x11 procps gosu \
    xvfb xauth \
    libgtk-3-0 libdbus-glib-1-2 libxt6 libx11-xcb1 libasound2 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash zotero

WORKDIR /opt

RUN case "${TARGETARCH}" in \
      amd64) ZOTERO_ARCH=linux-x86_64 ;; \
      arm64) ZOTERO_ARCH=linux-arm64 ;; \
      *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL "https://www.zotero.org/download/client/dl?channel=release&platform=${ZOTERO_ARCH}" \
      -o /tmp/zotero.tar.xz \
    && tar -xJf /tmp/zotero.tar.xz -C /opt \
    && mv /opt/Zotero_* /opt/zotero \
    && ln -sf /opt/zotero/zotero /usr/local/bin/zotero \
    && rm -f /tmp/zotero.tar.xz

COPY entrypoint.sh /entrypoint.sh
COPY install-api-plus.sh /install-api-plus.sh
COPY zotero-prefs.js /zotero-prefs.js
RUN sed -i 's/\r$//' /entrypoint.sh /install-api-plus.sh \
    && chmod +x /entrypoint.sh /install-api-plus.sh

ENV DISPLAY=:99
ENV HOME=/home/zotero
ENV ZOTERO_PROFILE=/home/zotero/Zotero

VOLUME ["/home/zotero/Zotero"]

EXPOSE 23119

ENTRYPOINT ["/entrypoint.sh"]
