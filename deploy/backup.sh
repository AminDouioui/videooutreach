#!/usr/bin/env bash
# Tägliches SQLite-Backup (konsistent per Online-Backup, auch während der Laufzeit).
# Behält die letzten 14 Sicherungen. Medien (data/media) sind rekonstruierbar (neu rendern) und nicht Teil des Backups.
#
# Cron (als der Benutzer, der docker ausführen darf), täglich 03:15:
#   15 3 * * * /srv/videooutreach/deploy/backup.sh >> /var/log/videooutreach-backup.log 2>&1
set -euo pipefail

PROJEKT_DIR="${PROJEKT_DIR:-${INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
DATA_DIR_HOST="${DATA_DIR_HOST:-$PROJEKT_DIR/data}"
BACKUP_DIR="${BACKUP_DIR:-$PROJEKT_DIR/backups}"
BEHALTEN="${BEHALTEN:-14}"

mkdir -p "$BACKUP_DIR"
ZIEL="$BACKUP_DIR/app-$(date +%Y%m%d-%H%M%S).db"

if [ ! -f "$DATA_DIR_HOST/app.db" ]; then
  echo "Datenbank $DATA_DIR_HOST/app.db nicht gefunden" >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATA_DIR_HOST/app.db" ".timeout 10000" ".backup '$ZIEL'"
else
  # Fallback ohne sqlite3 auf dem Host: better-sqlite3-Backup im laufenden app-Container
  cd "$PROJEKT_DIR"
  docker compose exec -T app node -e "
    const D=require('better-sqlite3');
    const db=new D('/data/app.db',{readonly:true});
    db.backup('/data/.backup-tmp.db').then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
  "
  mv "$DATA_DIR_HOST/.backup-tmp.db" "$ZIEL"
fi

gzip -f "$ZIEL"
echo "$(date -Is) Backup erstellt: $ZIEL.gz"

# Alte Sicherungen löschen (die neuesten $BEHALTEN bleiben)
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/app-*.db.gz 2>/dev/null | tail -n +"$((BEHALTEN + 1))" | while IFS= read -r alt; do
  rm -f -- "$alt"
  echo "Gelöscht: $alt"
done
