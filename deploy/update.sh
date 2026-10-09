#!/usr/bin/env bash
# Aktualisiert die laufende Installation auf den neuesten Stand von main.
# Wird von der GitHub Action per SSH aufgerufen (Forced Command im authorized_keys),
# kann aber auch manuell ausgeführt werden: bash /srv/videooutreach/deploy/update.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/srv/videooutreach}"
cd "$INSTALL_DIR"

# Nur ein Update gleichzeitig
exec 9>/tmp/videooutreach-update.lock
# Läuft schon eins, darauf warten (max. 30 min) statt abzubrechen – danach ist der Stand ggf. schon aktuell
flock -w 1800 9 || { echo "Es läuft seit 30 min ein anderes Update – Abbruch."; exit 1; }

echo "==> Code aktualisieren"
git fetch --quiet origin main
ALT=$(git rev-parse --short HEAD)
git merge --ff-only --quiet origin/main
NEU=$(git rev-parse --short HEAD)
echo "    $ALT -> $NEU"

echo "==> Image bauen"
# Lokal bauen statt ein 3-GB-Image aus der Registry zu laden: dank Build-Cache laufen bei
# Code-Änderungen nur COPY + next build neu (npm ci und Chrome nur bei geändertem package-lock).
docker compose build app

echo "==> Neu starten"
docker compose up -d --remove-orphans

echo "==> Warte auf Health-Check der App (max. 3 min)"
APP=$(docker compose ps -q app)
for _ in $(seq 1 36); do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$APP" 2>/dev/null || echo unbekannt)
  if [ "$STATUS" = "healthy" ]; then
    echo "    App ist gesund."
    docker compose ps
    echo "==> Update auf $NEU abgeschlossen."
    exit 0
  fi
  sleep 5
done

echo "FEHLER: App wurde nicht 'healthy' (Status: $STATUS). Letzte Logs:"
docker compose logs --tail 50 app
exit 1
