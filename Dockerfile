# syntax=docker/dockerfile:1
# Ein Image für beide Dienste (app = next start, worker = tsx worker/index.ts).
# Chrome-Abhängigkeiten laut Remotion-Doku (https://www.remotion.dev/docs/docker, Debian/Bookworm).

# Schichten so getrennt, dass ein Code-Deploy nur eine kleine Schicht ändert: node_modules + Chrome
# (~1,7 GB) liegen in einer eigenen Schicht, die sich nur mit package-lock.json ändert.

# ---------- Abhängigkeiten ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Native Module (better-sqlite3) bauen, falls kein Prebuild passt
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
# Remotions chrome-headless-shell schon beim Build laden (landet in node_modules/.remotion)
RUN npx remotion browser ensure

# ---------- Build-Stufe ----------
FROM deps AS build
COPY . .
# Next-Build braucht keine .env (Variablen werden erst zur Laufzeit gelesen).
# node_modules kommt in der Laufzeit-Stufe aus "deps", der Build-Cache gehört nicht ins Image.
RUN npm run build && rm -rf .next/cache node_modules

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
COPY --from=deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
# Standard: Web-App. Der Worker überschreibt den Befehl in docker-compose.yml.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
