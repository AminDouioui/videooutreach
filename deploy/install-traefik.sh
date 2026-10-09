#!/usr/bin/env bash
# Ein-Befehl-Installer/Updater für Video-Outreach hinter einem bestehenden Traefik (Docker).
#
#   bash deploy/install-traefik.sh email.prozessia.space
#   curl -fsSL https://raw.githubusercontent.com/AminDouioui/videooutreach/main/deploy/install-traefik.sh | bash -s -- email.prozessia.space
#
# Als root ausführen. Das Skript ist idempotent: erneutes Ausführen = Update (git pull + neues Image),
# .env und data/ bleiben erhalten. Traefik, die Website und andere Container werden NIE verändert
# (es wird nur gelesen: docker ps / docker inspect).
#
# Optionale Umgebungsvariablen:
#   INSTALL_DIR          Zielverzeichnis (Standard /srv/videooutreach)
#   REPO_URL             Git-Repository (Standard: öffentliches GitHub-Repo)
#   TRAEFIK_NETWORK      Netzwerk von Traefik (sonst automatisch erkannt)
#   TRAEFIK_ENTRYPOINT   Entrypoint für HTTPS (sonst automatisch erkannt)
#   TRAEFIK_CERTRESOLVER Certresolver (sonst automatisch erkannt)
#   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   überspringen die Rückfrage
#   DRY_RUN=1            kein git, kein compose up, kein cron, kein chown, keine Rückfragen;
#                        zeigt die erzeugte docker-compose.override.yml
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/AminDouioui/videooutreach.git}"
INSTALL_DIR="${INSTALL_DIR:-/srv/videooutreach}"
DRY_RUN="${DRY_RUN:-0}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARNUNG:\033[0m %s\n' "$*" >&2; }
fehler() { printf '\033[1;31mFEHLER:\033[0m %s\n' "$*" >&2; exit 1; }

# Alles steht in main(), damit "curl | bash" das Skript vollständig einliest, bevor etwas läuft.
main() {
  local DOMAIN="${1:-}"
  [ -n "$DOMAIN" ] || fehler "Domain fehlt. Aufruf: bash deploy/install-traefik.sh email.prozessia.space"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] \
    || fehler "Ungültige Domain: $DOMAIN"
  DOMAIN="${DOMAIN,,}"

  if [ "$DRY_RUN" != "1" ]; then
    [ "$(id -u)" -eq 0 ] || fehler "Bitte als root ausführen (sudo bash ...)."
  else
    info "DRY_RUN=1: git, docker compose up, cron und chown werden übersprungen."
  fi
  command -v docker >/dev/null 2>&1 || fehler "docker nicht gefunden."
  docker compose version >/dev/null 2>&1 || fehler "docker compose (Plugin v2) nicht gefunden."
  if [ "$DRY_RUN" != "1" ]; then
    command -v git >/dev/null 2>&1 || fehler "git nicht gefunden (apt-get install -y git)."
    command -v openssl >/dev/null 2>&1 || fehler "openssl nicht gefunden."
  fi

  # ---------- 1. Code holen / aktualisieren ----------
  if [ "$DRY_RUN" = "1" ]; then
    [ -d "$INSTALL_DIR" ] || fehler "DRY_RUN: INSTALL_DIR=$INSTALL_DIR existiert nicht (Kopie des Repos angeben)."
  elif [ -d "$INSTALL_DIR/.git" ]; then
    info "Aktualisiere Code in $INSTALL_DIR (git pull --ff-only)"
    git -C "$INSTALL_DIR" pull --ff-only
  elif [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    fehler "$INSTALL_DIR existiert und ist kein Git-Checkout. Anderen INSTALL_DIR wählen oder Ordner entfernen."
  else
    info "Klone $REPO_URL nach $INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"

  # ---------- 2. Traefik-Einstellungen erkennen (nur lesend) ----------
  info "Erkenne Traefik-Einstellungen aus den laufenden Containern"
  local net="${TRAEFIK_NETWORK:-}" ep="${TRAEFIK_ENTRYPOINT:-}" res="${TRAEFIK_CERTRESOLVER:-}"
  local ids id name labels router

  # Container-Reihenfolge: zuerst die Website, dann alle übrigen
  local order=""
  if docker inspect prozessia-website >/dev/null 2>&1; then order="prozessia-website"; fi
  ids="$(docker ps -q 2>/dev/null || true)"
  for id in $ids; do order="$order $id"; done

  local site_net_label=""
  if [ -z "$res" ] || [ -z "$ep" ] || [ -z "$net" ]; then
    for name in $order; do
      labels="$(docker inspect --format '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' "$name" 2>/dev/null || true)"
      [ -n "$labels" ] || continue
      if [ -z "$site_net_label" ]; then
        site_net_label="$(printf '%s\n' "$labels" | sed -n 's/^traefik\.docker\.network=//p' | head -n1)"
      fi
      if [ -z "$res" ]; then
        router="$(printf '%s\n' "$labels" | sed -n 's/^traefik\.http\.routers\.\([^.]*\)\.tls\.certresolver=.\+$/\1/p' | head -n1)"
        if [ -n "$router" ]; then
          res="$(printf '%s\n' "$labels" | sed -n "s/^traefik\.http\.routers\.${router}\.tls\.certresolver=//p" | head -n1)"
          if [ -z "$ep" ]; then
            ep="$(printf '%s\n' "$labels" | sed -n "s/^traefik\.http\.routers\.${router}\.entrypoints=//p" | head -n1 | cut -d, -f1 | tr -d ' ')"
          fi
        fi
      fi
    done
  fi

  # Fallback: Startargumente des Traefik-Containers
  if [ -z "$res" ] || [ -z "$ep" ]; then
    local args
    args="$(docker inspect --format '{{range .Args}}{{.}}{{"\n"}}{{end}}{{range .Config.Cmd}}{{.}}{{"\n"}}{{end}}' traefik 2>/dev/null || true)"
    if [ -z "$res" ]; then
      res="$(printf '%s\n' "$args" | sed -n 's/^--certificatesresolvers\.\([^.=]*\)\..*/\1/p' | head -n1)"
    fi
    if [ -z "$ep" ]; then
      ep="$(printf '%s\n' "$args" | sed -n 's/^--entrypoints\.\([^.=]*\)\.address=:443$/\1/p' | head -n1)"
    fi
  fi

  # Netzwerk
  if [ -z "$net" ]; then
    if [ -n "$site_net_label" ]; then
      net="$site_net_label"
    else
      local tnets snets n
      tnets="$(docker inspect --format '{{range $n, $_ := .NetworkSettings.Networks}}{{$n}}{{"\n"}}{{end}}' traefik 2>/dev/null || true)"
      snets="$(docker inspect --format '{{range $n, $_ := .NetworkSettings.Networks}}{{$n}}{{"\n"}}{{end}}' prozessia-website 2>/dev/null || true)"
      for n in $tnets; do
        case "$n" in bridge|host|none) continue ;; esac
        if printf '%s\n' "$snets" | grep -qx "$n"; then net="$n"; break; fi
      done
      if [ -z "$net" ]; then
        for n in $tnets; do
          case "$n" in bridge|host|none) continue ;; esac
          net="$n"; break
        done
      fi
    fi
  fi

  echo "    Netzwerk:      ${net:-<unbekannt>}"
  echo "    Entrypoint:    ${ep:-<unbekannt>}"
  echo "    Certresolver:  ${res:-<unbekannt>}"
  if [ -z "$net" ] || [ -z "$ep" ] || [ -z "$res" ]; then
    fehler "Traefik-Einstellungen nicht eindeutig erkennbar (fehlt: $([ -z "$net" ] && echo Netzwerk) $([ -z "$ep" ] && echo Entrypoint) $([ -z "$res" ] && echo Certresolver)).
Läuft der Container 'traefik'? Sonst Werte per Umgebungsvariable setzen, z. B.:
  TRAEFIK_NETWORK=proxy TRAEFIK_ENTRYPOINT=websecure TRAEFIK_CERTRESOLVER=letsencrypt bash deploy/install-traefik.sh $DOMAIN"
  fi
  if [ "$DRY_RUN" != "1" ]; then
    docker network inspect "$net" >/dev/null 2>&1 || fehler "Docker-Netzwerk '$net' existiert nicht."
  fi

  # ---------- 3. .env ----------
  local NEW_PASSWORD=""
  if [ -f .env ]; then
    info ".env existiert bereits und bleibt unverändert"
    local cur_url
    cur_url="$(sed -n 's/^APP_URL=//p' .env | head -n1 | tr -d '"'"'")"
    if [ "$cur_url" != "https://$DOMAIN" ]; then
      warn "APP_URL in .env ($cur_url) weicht von https://$DOMAIN ab. Bitte prüfen."
    fi
    if ! grep -q '^APP_PORT=' .env; then
      APP_PORT="$(freien_port)"
      printf '\nAPP_PORT=%s\n' "$APP_PORT" >> .env
      info "APP_PORT=$APP_PORT in .env ergänzt"
    fi
  else
    info "Erzeuge .env"
    local gid="${GOOGLE_CLIENT_ID:-}" gsec="${GOOGLE_CLIENT_SECRET:-}"
    if [ "$DRY_RUN" != "1" ]; then
      if [ -z "$gid" ] && [ -z "${GOOGLE_CLIENT_ID+x}" ]; then
        gid="$(frage "Google OAuth Client-ID (leer lassen = später eintragen): " 0)"
      fi
      if [ -z "$gsec" ] && [ -z "${GOOGLE_CLIENT_SECRET+x}" ]; then
        gsec="$(frage "Google OAuth Client-Secret (Eingabe versteckt): " 1)"
      fi
    fi
    if [ -z "$gid" ] || [ -z "$gsec" ]; then
      warn "Google Client-ID/-Secret fehlen. Später in $INSTALL_DIR/.env eintragen und 'docker compose up -d' ausführen."
    fi
    if [ "$DRY_RUN" = "1" ]; then
      NEW_PASSWORD="DryRunPasswort123"
    else
      NEW_PASSWORD="$(zufall_alnum 16)"
    fi
    APP_PORT="$(freien_port)"
    local sess enc salt
    if [ "$DRY_RUN" = "1" ]; then
      sess="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      enc="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      salt="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    else
      sess="$(openssl rand -hex 32)"; enc="$(openssl rand -hex 32)"; salt="$(openssl rand -hex 16)"
    fi
    ( umask 077
      {
        echo "# Erzeugt von deploy/install-traefik.sh am $(date -Is). Nicht ins Repository einchecken."
        echo "APP_URL=https://$DOMAIN"
        echo "ADMIN_PASSWORD=$NEW_PASSWORD"
        echo "SESSION_SECRET=$sess"
        echo "ENCRYPTION_KEY=$enc"
        echo "IP_HASH_SALT=$salt"
        echo "DATA_DIR=/data"
        echo "RENDER_CONCURRENCY=1"
        echo "FFMPEG_PATH=ffmpeg"
        echo "GOOGLE_CLIENT_ID=$(env_wert "$gid")"
        echo "GOOGLE_CLIENT_SECRET=$(env_wert "$gsec")"
        echo "GOOGLE_REDIRECT_URI=https://$DOMAIN/api/gmail/callback"
        echo "SENDER_EMAIL=Amin.douioui@prozessia.de"
        echo 'SENDER_NAME="Amin Douioui"'
        echo "DEFAULT_CTA_URL=https://calendly.com/sebastian-spuhler/30min"
        echo "IMPRESSUM_URL=https://prozessia.de/impressum"
        echo "DATENSCHUTZ_URL=https://prozessia.de/datenschutz"
        echo "APP_PORT=$APP_PORT"
      } > .env )
  fi
  chmod 600 .env

  # ---------- 4. Compose: Port lokal binden, Override erzeugen ----------
  if grep -q '"127.0.0.1:3000:3000"' docker-compose.yml; then
    sed -i 's|"127.0.0.1:3000:3000"|"127.0.0.1:${APP_PORT:-3000}:3000"|' docker-compose.yml
    info "docker-compose.yml: App-Port auf APP_PORT umgestellt"
  fi
  grep -qx 'docker-compose.override.yml' .gitignore 2>/dev/null || echo 'docker-compose.override.yml' >> .gitignore

  cat > docker-compose.override.yml <<YML
# Erzeugt von deploy/install-traefik.sh – wird bei jedem Lauf neu geschrieben, nicht von Hand ändern.
# Domain: ${DOMAIN} | Traefik-Netzwerk: ${net} | Entrypoint: ${ep} | Certresolver: ${res}
# Die HTTP->HTTPS-Weiterleitung übernimmt der bestehende Traefik (kein eigener Redirect hier).
services:
  app:
    networks: [default, traefik_extern]
    labels:
      - com.centurylinklabs.watchtower.enable=false
      - traefik.enable=true
      - traefik.docker.network=${net}
      - traefik.http.routers.videooutreach.rule=Host(\`${DOMAIN}\`)
      - traefik.http.routers.videooutreach.entrypoints=${ep}
      - traefik.http.routers.videooutreach.tls=true
      - traefik.http.routers.videooutreach.tls.certresolver=${res}
      - traefik.http.routers.videooutreach.priority=1
      - traefik.http.routers.videooutreach.service=videooutreach
      - traefik.http.services.videooutreach.loadbalancer.server.port=3000

  worker:
    labels:
      - com.centurylinklabs.watchtower.enable=false

  media:
    image: nginx:1.27-alpine
    restart: unless-stopped
    volumes:
      - ./data/media:/usr/share/nginx/html/media:ro
      - ./deploy/media-nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks: [traefik_extern]
    labels:
      - com.centurylinklabs.watchtower.enable=false
      - traefik.enable=true
      - traefik.docker.network=${net}
      - traefik.http.routers.videooutreach-media.rule=Host(\`${DOMAIN}\`) && PathPrefix(\`/media/\`)
      - traefik.http.routers.videooutreach-media.entrypoints=${ep}
      - traefik.http.routers.videooutreach-media.tls=true
      - traefik.http.routers.videooutreach-media.tls.certresolver=${res}
      - traefik.http.routers.videooutreach-media.priority=10
      - traefik.http.routers.videooutreach-media.service=videooutreach-media
      - traefik.http.services.videooutreach-media.loadbalancer.server.port=80

networks:
  traefik_extern:
    external: true
    name: ${net}
YML
  info "docker-compose.override.yml geschrieben"
  if [ "$DRY_RUN" = "1" ]; then
    echo "----- docker-compose.override.yml -----"
    cat docker-compose.override.yml
    echo "---------------------------------------"
  fi

  # ---------- 5. Verzeichnisse, Swap-Hinweis ----------
  mkdir -p data/media data/cache backups
  if [ "$DRY_RUN" != "1" ]; then
    chown -R 1000:1000 data
  fi
  if [ -z "$(swapon --show --noheadings 2>/dev/null || true)" ]; then
    warn "Kein Swap aktiv. Empfehlung bei Chrome-Rendern neben ~30 Containern (wird NICHT automatisch angelegt):
         fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
         echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  fi

  # ---------- 6. DNS-Prüfung ----------
  local dns_ip pub_ip
  dns_ip="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  pub_ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$pub_ip" ] || pub_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [ -z "$dns_ip" ]; then
    warn "$DOMAIN hat keinen DNS-Eintrag. Ohne A-Record auf ${pub_ip:-die Server-IP} kann Let's Encrypt kein Zertifikat ausstellen."
  elif [ -n "$pub_ip" ] && [ "$dns_ip" != "$pub_ip" ]; then
    warn "$DOMAIN zeigt auf $dns_ip, dieser Server hat aber $pub_ip. Der A-Record muss auf den Server zeigen, sonst scheitert die Zertifikatsausstellung (Let's Encrypt)."
  else
    info "DNS ok: $DOMAIN -> $dns_ip"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    info "DRY_RUN beendet (kein Build, kein Cron)."
    return 0
  fi

  # ---------- 7. Starten ----------
  # Fertiges Image aus der GitHub Container Registry laden (gebaut von der GitHub Action).
  # Nur wenn das nicht klappt, wird auf dem Server selbst gebaut (dauert auf ausgelasteten Servern lange).
  info "Lade Image (docker compose pull)"
  if docker compose pull app worker; then
    docker compose up -d --remove-orphans
  else
    warn "Image konnte nicht geladen werden – baue lokal (kann lange dauern)."
    docker compose build app
    docker compose up -d --remove-orphans
  fi
  info "Warte auf Health der App (max. 3 Minuten)"
  local i status="" cid
  for i in $(seq 1 36); do
    cid="$(docker compose ps -q app 2>/dev/null || true)"
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
    [ "$status" = "healthy" ] && break
    sleep 5
  done
  [ "$status" = "healthy" ] || warn "App ist nach 3 Minuten nicht 'healthy' (Status: ${status:-unbekannt}). Logs: cd $INSTALL_DIR && docker compose logs app"
  docker compose ps
  echo "--- letzte Worker-Logzeilen ---"
  docker compose logs --tail=15 worker || true

  # ---------- 8. Backup-Cron ----------
  cat > /etc/cron.d/videooutreach-backup <<CRON
# Erzeugt von deploy/install-traefik.sh
15 3 * * * root INSTALL_DIR=${INSTALL_DIR} /bin/bash ${INSTALL_DIR}/deploy/backup.sh >> ${INSTALL_DIR}/backups/backup.log 2>&1
CRON
  chmod 644 /etc/cron.d/videooutreach-backup
  command -v sqlite3 >/dev/null 2>&1 || info "Hinweis: 'apt-get install -y sqlite3' empfohlen; sonst nutzt das Backup den App-Container."

  # ---------- 9. Zusammenfassung ----------
  echo
  echo "============================================================"
  echo " Video-Outreach ist installiert"
  echo "============================================================"
  echo " URL:  https://$DOMAIN"
  if [ -n "$NEW_PASSWORD" ]; then
    echo
    echo "   ADMIN-PASSWORT (nur jetzt sichtbar, bitte notieren):"
    echo "   >>>  $NEW_PASSWORD  <<<"
    echo "   (steht auch in $INSTALL_DIR/.env)"
  else
    echo " Admin-Passwort: unverändert, siehe $INSTALL_DIR/.env"
  fi
  cat <<TXT

 Nächste Schritte:
  1. Google Cloud Console -> OAuth-Client -> Autorisierte Weiterleitungs-URI eintragen:
       https://$DOMAIN/api/gmail/callback
  2. https://$DOMAIN/einstellungen öffnen -> „Gmail verbinden“.
  3. Dort die E-Mail-Signatur setzen.
  4. Update später: Skript erneut ausführen (git pull + neues Image, .env und data bleiben):
       bash $INSTALL_DIR/deploy/install-traefik.sh $DOMAIN
  Backup: täglich 03:15 per /etc/cron.d/videooutreach-backup -> $INSTALL_DIR/backups
TXT
}

# ---------- Hilfsfunktionen ----------
zufall_alnum() { # $1 = Länge
  local s=""
  while [ "${#s}" -lt "$1" ]; do
    s="$s$(head -c 64 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' || true)"
  done
  printf '%s' "${s:0:$1}"
}

freien_port() {
  local p=3300 used=""
  used="$(ss -ltn 2>/dev/null | awk 'NR>1{n=split($4,a,":"); print a[n]}' || true)"
  while printf '%s\n' "$used" | grep -qx "$p"; do p=$((p + 1)); done
  printf '%s' "$p"
}

# Rückfrage über /dev/tty (funktioniert auch bei "curl | bash"); $2=1 -> Eingabe versteckt
frage() {
  local antwort=""
  if [ ! -r /dev/tty ] || ! : </dev/tty 2>/dev/null; then
    printf '' ; return 0
  fi
  if [ "$2" = "1" ]; then
    read -r -s -p "$1" antwort </dev/tty >&2 || true
    echo >&2
  else
    read -r -p "$1" antwort </dev/tty >&2 || true
  fi
  printf '%s' "$antwort"
}

# Wert für .env sicher quotieren (Zeichen wie $ oder # bleiben erhalten)
env_wert() {
  case "$1" in
    '') printf '' ;;
    *\'*) printf '"%s"' "$1" ;;
    *) printf "'%s'" "$1" ;;
  esac
}

main "$@" </dev/null
