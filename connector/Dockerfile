# Build Zotero20 Connector (Chrome MV3 + Firefox MV2) — no WSL/Git Bash required on Windows.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git rsync jq python3 perl ca-certificates zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY docker-build.sh /usr/local/bin/docker-build.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-build.sh && chmod +x /usr/local/bin/docker-build.sh

ENTRYPOINT ["/usr/local/bin/docker-build.sh"]
