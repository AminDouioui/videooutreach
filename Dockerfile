# syntax=docker/dockerfile:1
# Ein Image für beide Dienste (app = next start, worker = tsx worker/index.ts).
# Chrome-Abhängigkeiten laut Remotion-Doku (https://www.remotion.dev/docs/docker, Debian/Bookworm).

# ---------- Build-Stufe ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Native Module (better-sqlite3) bauen, falls kein Prebuild passt
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Next-Build braucht keine .env (Variablen werden erst zur Laufzeit gelesen)
RUN npm run build
# Remotions chrome-headless-shell schon beim Build laden (kein Download zur Laufzeit)
RUN npx remotion browser ensure

# ---------- Laufzeit-Stufe ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    FFMPEG_PATH=ffmpeg
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg \
      libnss3 libdbus-1-3 libatk1.0-0 libasound2 libxrandr2 libxkbcommon-dev \
      libxfixes3 libxcomposite1 libxdamage1 libgbm-dev libcups2 libcairo2 \
      libpango-1.0-0 libatk-bridge2.0-0 \
      fonts-liberation fonts-noto-color-emoji fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Benutzer "node" (uid 1000) – /data muss für uid 1000 beschreibbar sein
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
# Standard: Web-App. Der Worker überschreibt den Befehl in docker-compose.yml.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
