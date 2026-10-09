# Video-Outreach-Dashboard

Selbst gehostete Web-App für personalisierte Video-Kaltakquise: Leads importieren, pro Lead ein Video rendern (Remotion), gedrosselt per Gmail versenden und das Verhalten auf der Video-Seite auswerten. Fachliche Anforderungen: `BRIEFING.md`, technische Vorgaben: `SPEC.md`.

## Inhalt

1. [Überblick](#überblick) · 2. [Funktionen](#funktionen) · 3. [Architektur](#architektur) · 4. [Lokale Entwicklung](#lokale-entwicklung) · 5. [Umgebungsvariablen](#umgebungsvariablen) · 6. [Gmail-Einrichtung](#gmail-einrichtung) · 7. [Versandregeln](#versandregeln) · 8. [Tracking, Bot-Erkennung, Score](#tracking-bot-erkennung-und-score) · 9. [Rendern mit Remotion](#rendern-mit-remotion) · 10. [Deployment](#deployment) · 11. [Fehlerbehebung](#fehlerbehebung) · 12. [Datenschutz](#datenschutz-hinweise)

## Überblick

Ablauf: Excel/CSV mit Leads hochladen, pro Lead entsteht ein eigenes Video (personalisiertes Intro mit Firmenname + Teaser) samt Vorschaubild. Jeder Lead bekommt eine nicht erratbare Video-Seite `https://video.DEINEDOMAIN.de/v/<slug>`. Die E-Mail mit klickbarem Vorschaubild geht über die Gmail-API raus, das Dashboard zeigt, wer das Video angeschaut und den Termin-Button geklickt hat.

## Funktionen

- Login mit Admin-Passwort (ein Zugang), Kampagnen, Vorlagen mit Platzhaltern, Vorschau, Testmail.
- Vorlagen: Spintax `{Hallo|Guten Tag}` (verschachtelbar, pro Lead stabil gewählt, auch in Betreff/Follow-ups), eigene Variablen aus nicht zugeordneten Import-Spalten (`{{stadt}}`, normalisiert), zusätzlich `{{position}}`, `{{website}}`, `{{email}}`, `{{absender_name}}`, und Fallbacks `{{vorname|Hallo zusammen}}`. Editor zeigt Variablen, Hilfe und Warnungen; unbalancierte Klammern verhindern das Speichern.
- A/B-Tests: Die Kampagnen-Vorlage ist Variante A, auf der Vorlagen-Seite kommen bis zu vier weitere Varianten (B–E, je Betreff + Text, aktiv/inaktiv) dazu. Jede Erstmail geht gleichmäßig rotierend mit der Variante raus, die bisher am seltensten gesendet wurde (`leads.variante`); Follow-ups nutzen den Betreff der Variante des Leads. Auswertung je Variante (gesendet, Video-Seite, Play, Termin-Klick, Antworten, Raten) auf der Kampagnenseite, Variante auch im CSV-Export.
- Import `.xlsx`/`.csv` mit Spalten-Mapping, Validierung (ungültige E-Mails, Duplikate, Sperrliste).
- Rendern aller Leads, nur fehlgeschlagener oder einzelner Leads neu; Fortschritt im Dashboard.
- Öffentliche Video-Seite (mobil, ohne Cookies/Fremd-Skripte, `noindex`).
- Versand mit Warteschlange, Versandfenster, Tageslimit, zufälligem Abstand, Pausieren/Fortsetzen.
- Abmeldelink (Seite + One-Click per `List-Unsubscribe-Post`), kampagnenübergreifende Sperrliste.
- Tracking mit Score, Lead-Detail mit Event-Zeitleiste, CSV-Export.

## Architektur

```
Browser ──► Reverse Proxy (nginx/Caddy/Traefik, TLS)
              ├─ /media/*  ──► Dateien direkt von der Platte (Range, lange Cache-Header)
              └─ alles andere ─► app (Next.js, 127.0.0.1:3000)
                                   │   SQLite  /data/app.db   ◄──┐
worker (tsx worker/index.ts) ──────┴── Remotion-Render, Gmail-Versand
                                       Medien /data/media/<slug>.mp4|.jpg
```

- `app/`, `components/`, `lib/`: Next.js 15 (App Router), SQLite über better-sqlite3 + Drizzle, Migrationen in `db/migrations` (werden beim Start automatisch angewendet; Arbeitsverzeichnis muss das Projektverzeichnis sein).
- `worker/`: eigener Prozess; bundelt die Remotion-Komposition einmal, rendert Videos (H.264, 720p) und Vorschaubilder, sendet Mails. Hängende Render-Jobs werden beim Start wieder aufgenommen.
- `remotion/`: Kompositionen `OutreachIntro` (personalisiertes Intro, wird pro Lead gerendert), `OutreachThumbnail` (Vorschaubild) und `OutreachVideo` (Intro + Teaser, nur zur Vorschau im Studio). Teaser in `remotion/public/teaser.mp4`.
- Beide Prozesse teilen sich `DATA_DIR` (Datenbank + `media/`). In Produktion laufen sie als Docker-Dienste `app` und `worker` aus einem Image.

## Lokale Entwicklung

Voraussetzungen: Node 22, npm, für das Rendern ein `ffmpeg` im PATH (oder `FFMPEG_PATH`).

```bash
npm install
cp .env.example .env      # Werte eintragen (siehe unten)
openssl rand -hex 32      # für SESSION_SECRET und ENCRYPTION_KEY (je ein eigener Wert)
npm run dev               # Web-App auf http://localhost:3000
npm run worker            # in zweitem Terminal: Rendern + Versand
npm run remotion:studio   # Remotion Studio zum Bearbeiten der Komposition
```

Beim ersten Render lädt Remotion `chrome-headless-shell` herunter (Internet nötig) oder nutzt `REMOTION_BROWSER_EXECUTABLE`.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Next.js-Entwicklungsserver |
| `npm run build` / `npm start` | Produktions-Build / -Server |
| `npm run worker` | Render- und Versand-Schleife |
| `npm run remotion:studio` | Remotion Studio |
| `npm run lint` · `npm run typecheck` · `npm test` | Qualitätschecks |
| `npm run db:generate` | Neue Drizzle-Migration aus `db/schema.ts` erzeugen |
| `npm run fixtures` | Test-Dateien `test/fixtures/leads-test.{xlsx,csv}` neu erzeugen |

Zum Ausprobieren: anmelden, Kampagne anlegen, `test/fixtures/leads-test.xlsx` hochladen, Spalten prüfen, importieren (erwartet: 8 gültig, 1 Duplikat, 1 ungültige E-Mail), „Alle rendern“. Lokal liefert die App `/media/*` selbst aus; in Produktion übernimmt der Reverse Proxy.

## Umgebungsvariablen

Vorlage: `.env.example`. Die `.env` gehört nie ins Repository. Fehlende Pflichtwerte führen beim ersten Zugriff zu einem Fehler (`next build` geht auch ohne `.env`).

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `APP_URL` | ja (Prod) | Öffentliche Basis-URL, z. B. `https://video.DEINEDOMAIN.de`. `https://` aktiviert das `secure`-Cookie; wird in Mail- und Video-Links verwendet |
| `ADMIN_PASSWORD` | ja | Passwort des Admin-Logins |
| `SESSION_SECRET` | ja | Signatur der Session, min. 32 Zeichen |
| `ENCRYPTION_KEY` | ja | 64 Hex-Zeichen (AES-256-GCM für OAuth-Tokens) |
| `IP_HASH_SALT` | ja | Salt für gehashte IP-Adressen |
| `APP_PORT` | nein | Lokaler Host-Port der App (nur `127.0.0.1`), Standard 3000; der Traefik-Installer wählt einen freien Port ab 3300 |
| `DATA_DIR` | nein | Datenverzeichnis, Standard `./data`; im Docker-Betrieb `/data` (setzt Compose) |
| `RENDER_CONCURRENCY` | nein | Parallele Render-Jobs (1–8, Standard 1) |
| `REMOTION_BROWSER_EXECUTABLE` | nein | Eigener Chrome/headless_shell; im Docker-Image leer lassen |
| `FFMPEG_PATH` | nein | Pfad zum `ffmpeg`-Binary (Standard `ffmpeg`; im Image vorhanden) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | für Versand | OAuth-Client aus der Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | für Versand | Muss exakt zur Redirect-URI in der Cloud Console passen, `https://video.DEINEDOMAIN.de/api/gmail/callback` |
| `SENDER_EMAIL`, `SENDER_NAME` | nein | Absenderadresse und -name |
| `DEFAULT_CTA_URL` | nein | Standard-Termin-Link neuer Kampagnen |
| `IMPRESSUM_URL`, `DATENSCHUTZ_URL` | empfohlen | Links im Footer der Video-Seite |
| `SEND_MIN_GAP_MINUTES`, `SEND_MAX_GAP_MINUTES` | nein | Zufälliger Abstand zwischen zwei Mails (Standard 3 bis 9) |

## Gmail-Einrichtung

Ausführliche Schritt-für-Schritt-Anleitung: **[docs/gmail-einrichtung.md](docs/gmail-einrichtung.md)**.

Kurzfassung: In der Google Cloud Console ein Projekt anlegen, die Gmail API aktivieren, den OAuth-Zustimmungsbildschirm als „Intern“ (Workspace) mit dem Bereich `gmail.send` einrichten, einen OAuth-Client „Webanwendung“ erstellen und als Weiterleitungs-URIs `http://localhost:3000/api/gmail/callback` sowie `https://video.DEINEDOMAIN.de/api/gmail/callback` eintragen. Client-ID, Secret und Redirect-URI in die `.env`, Dienste neu starten, im Dashboard unter Einstellungen „Gmail verbinden“ und mit einer Testmail prüfen.

## Versandregeln

- Es werden nur fertig gerenderte, nicht gesperrte und nicht abgemeldete Leads versendet.
- Versandfenster: Standard Montag bis Freitag, 08 bis 17 Uhr (Europe/Berlin).
- Tageslimit: Standard 30 Mails, über alle Kampagnen hinweg.
- Zufälliger Abstand zwischen zwei Mails: 3 bis 9 Minuten (`SEND_MIN_GAP_MINUTES`/`SEND_MAX_GAP_MINUTES`).
- Pausieren und Fortsetzen jederzeit; Fehler werden pro Lead gespeichert. Meldet Gmail ein Limit (Quota), stoppt der Versand für den Tag.
- Mails: `multipart/alternative`, schlichtes HTML, kein Anhang, Signatur mit Impressumsangaben, Abmeldelink sowie `List-Unsubscribe` und `List-Unsubscribe-Post`.
- Neue Absenderdomänen langsam hochfahren (10, dann 20, dann 30 pro Tag); SPF, DKIM und DMARC müssen eingerichtet sein.

## Tracking, Bot-Erkennung und Score

- Die Video-Seite sendet Ereignisse per `POST /api/t` (`sendBeacon`): `page_view` (nur per JavaScript), `play`, Fortschritt 25/50/75/100 %, `cta_click`. Das Öffnungs-Pixel ist optional (standardmäßig aus) und gilt als unzuverlässig.
- Bot-Erkennung: Anfragen mit typischen User-Agents von Link-Scannern und Vorschau-Diensten (Safe Links, Proofpoint, Mimecast, Crawler, Preview-Bots) werden als Bot markiert, im Dashboard grau dargestellt und nicht gewertet.
- Score (nur Nicht-Bot-Ereignisse): `play` 10 (einmalig), 50 % gesehen 10, 100 % gesehen 15, Termin-Klick 30 (einmalig), plus 5 je weiterem Besuchstag. Das Dashboard sortiert standardmäßig nach Score absteigend.
- IP-Adressen werden nur gesalzen gehasht gespeichert; Ratelimit am Tracking-Endpunkt.

## Rendern mit Remotion

- Der Worker bundelt `remotion/` einmal beim Start. Pro Lead rendert Remotion nur das 5-Sekunden-Intro (`OutreachIntro`: „Guten Tag …, ein Video für {Firma}“, endet in Weiß). Der Teaser wird **einmal** passend vorkodiert (`DATA_DIR/cache/teaser-*.mp4`) und per ffmpeg ohne Neukodierung angehängt. Dadurch dauert ein Lead ca. 10 s statt mehrerer Minuten (200 Leads ≈ 35 min mit `RENDER_CONCURRENCY=1`). Ergebnis: `DATA_DIR/media/<slug>.mp4` (1280x720, 30 fps, H.264/AAC, ca. 64 s, ca. 3,5 MB) und `<slug>.jpg` (Vorschaubild mit Play-Button).
- `DATA_DIR/cache` darf jederzeit gelöscht werden; der Worker baut den Teaser-Cache neu auf (30–70 s).
- **Teaser austauschen:** Datei `remotion/public/teaser.mp4` durch das neue Video ersetzen (gleicher Dateiname, 16:9 empfohlen, mit Ton). Der Worker erkennt die Änderung und kodiert den Teaser beim nächsten Job automatisch neu. Bereits gerenderte Videos bleiben unverändert; sie müssen pro Lead mit „Video neu rendern“ neu erzeugt werden. Im Docker-Betrieb danach `docker compose up -d --build`, da der Teaser im Image liegt.
- Komposition ansehen/ändern: `npm run remotion:studio`.
- Rendern braucht RAM (Chrome): für `RENDER_CONCURRENCY=1` rund 2 bis 3 GB freien Speicher einplanen.

## Deployment

Zielsystem: Hetzner-Cloud-Server (Ubuntu), auf dem bereits die Website des Kunden läuft. Die bestehende Konfiguration der Website wird nicht verändert; die App bekommt eine eigene Subdomain. Daten liegen auf dem Host in `/srv/videooutreach/data` (Datenbank `app.db`, Medien `media/`).

Dateien: `Dockerfile`, `docker-compose.yml`, `deploy/nginx/video.conf.example`, `deploy/Caddyfile.example`, `deploy/traefik-compose.override.example.yml`, `deploy/caddy-compose.override.example.yml`, `deploy/backup.sh`.

### 1. DNS

Beim Domain-Anbieter einen **A-Record** `video` → öffentliche IPv4 des Servers anlegen (optional AAAA für IPv6). Prüfen mit `dig +short video.DEINEDOMAIN.de`. Erst weitermachen, wenn die richtige IP erscheint (sonst scheitert die Zertifikatsausstellung).

### 2. Server vorbereiten

```bash
sudo apt update && sudo apt -y upgrade
sudo ufw status            # 22, 80, 443 müssen offen sein; Port 3000 NICHT öffnen
sudo mkdir -p /srv/videooutreach && sudo chown $USER: /srv/videooutreach
free -h                    # mind. 4 GB RAM empfohlen (Rendern); sonst 2 GB Swap anlegen
```

Welchen Webserver die bestehende Website nutzt, zeigt `sudo ss -tlnp | grep -E ':(80|443)\s'` (Prozessname nginx, caddy, apache2, traefik/docker-proxy).

### 3. Docker installieren

Offizielle Anleitung: <https://docs.docker.com/engine/install/ubuntu/>. Kurz:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # danach neu einloggen
docker compose version
```

Läuft Docker bereits für die Website, entfällt dieser Schritt.

### 4. Code holen und konfigurieren

```bash
cd /srv/videooutreach
git clone <REPO-URL> .
cp .env.example .env
nano .env        # siehe Tabelle oben; Secrets mit `openssl rand -hex 32` erzeugen
chmod 600 .env
mkdir -p data && sudo chown -R 1000:1000 data     # Container läuft als uid 1000 (Benutzer "node")
```

Wichtige Werte in der `.env`: `APP_URL=https://video.DEINEDOMAIN.de`, `GOOGLE_REDIRECT_URI=https://video.DEINEDOMAIN.de/api/gmail/callback`, alle Pflicht-Secrets. `DATA_DIR` setzt Compose auf `/data` (Bind-Mount von `./data`).

### 5. Starten

```bash
docker compose up -d --build
docker compose ps                  # app sollte "healthy" sein
curl -I http://127.0.0.1:3000/login
docker compose logs -f worker      # erwartet: Remotion-Bundle fertig, "[worker] Läuft …"
```

Der erste Build dauert einige Minuten (Abhängigkeiten, Next-Build, Chrome-Download). Die App ist nur auf `127.0.0.1:3000` erreichbar und noch nicht öffentlich.

### 6. Reverse-Proxy-Variante wählen

Mediendateien (`/media/*`) liefert der Proxy direkt aus `/srv/videooutreach/data/media/` aus; alles andere geht an `127.0.0.1:3000`. Bei abweichendem Projektpfad den Pfad in der Proxy-Konfiguration anpassen.

**A) nginx auf dem Host** (bestehende Website nutzt nginx):

```bash
sudo cp deploy/nginx/video.conf.example /etc/nginx/sites-available/video.conf
sudo sed -i 's/DEINEDOMAIN/ihre-domain/g' /etc/nginx/sites-available/video.conf
```

Zertifikat zuerst ausstellen, solange der 443-Block noch kein Zertifikat hat: den `server`-Block für 443 vorübergehend auskommentieren, aktivieren und mit `sudo certbot certonly --webroot -w /var/www/html -d video.DEINEDOMAIN.de` (oder `--nginx`) das Zertifikat holen, dann den 443-Block einkommentieren:

```bash
sudo ln -s /etc/nginx/sites-available/video.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Certbot erneuert automatisch (`systemctl list-timers | grep certbot`). Die Datei `data/media` muss für nginx lesbar sein (`chmod o+rx data data/media`, falls nötig).

**B) Caddy auf dem Host** (oder noch kein Webserver): `deploy/Caddyfile.example` in `/etc/caddy/Caddyfile` übernehmen (Domain und Pfad anpassen), `sudo systemctl reload caddy`. Das Zertifikat holt Caddy automatisch. Läuft auf dem Server noch gar nichts auf Port 80/443, kann Caddy auch als Container laufen: `deploy/caddy-compose.override.example.yml` nach `docker-compose.override.yml` und `deploy/Caddyfile.docker.example` nach `Caddyfile` kopieren, Domain anpassen, `docker compose up -d`.

**C) Traefik (Docker)**: `deploy/traefik-compose.override.example.yml` nach `docker-compose.override.yml` kopieren, Netzwerkname, Entrypoint und Certresolver an die vorhandene Traefik-Konfiguration anpassen. Ein kleiner nginx-Container (`media`, Konfiguration `deploy/media-nginx.conf`) liefert `/media/` direkt aus.

**D) Apache**: Als Reverse Proxy genügt `ProxyPass / http://127.0.0.1:3000/` mit `ProxyPreserveHost On` und `RequestHeader set X-Forwarded-Proto "https"` (Module `proxy`, `proxy_http`, `headers`), plus `Alias /media/ /srv/videooutreach/data/media/` mit `ProxyPass /media/ !` davor und `Header set Cache-Control "public, max-age=31536000, immutable"`. Zertifikat per `certbot --apache`. Eine fertige Beispieldatei liegt nicht bei; die Zeilen gehören in einen eigenen VirtualHost nur für die Subdomain.

**Variante Traefik (Ein-Befehl-Installation)**

Für Server, auf denen bereits ein Traefik-Container (Ports 80/443) läuft. Das Skript `deploy/install-traefik.sh` liest die Traefik-Einstellungen (Netzwerk, Entrypoint, Certresolver) nur lesend aus den Docker-Labels der laufenden Container aus und verändert weder Traefik noch andere Container. Als root ausführen, A-Record der Domain vorher anlegen:

```bash
curl -fsSL https://raw.githubusercontent.com/AminDouioui/videooutreach/main/deploy/install-traefik.sh | bash -s -- email.prozessia.space
# oder nach dem Klonen:
bash deploy/install-traefik.sh email.prozessia.space
```

Das Skript klont nach `/srv/videooutreach` (`INSTALL_DIR`), erzeugt `.env` (Zufallswerte, fragt Google Client-ID/-Secret ab) und `docker-compose.override.yml`, startet alles, wartet auf die Health der App und richtet den Backup-Cron (täglich 03:15) ein. Erkennung übersteuern: `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERTRESOLVER`. Trockenlauf: `DRY_RUN=1`. **Update** = Skript erneut ausführen (git pull + Rebuild, `.env` und `data/` bleiben). Danach Redirect-URI in der Google Cloud Console eintragen und unter `/einstellungen` „Gmail verbinden“.

### 7. HTTPS prüfen

`https://video.DEINEDOMAIN.de/login` im Browser öffnen (Schloss-Symbol, Login-Seite). `curl -I https://video.DEINEDOMAIN.de/media/x.mp4` ohne Datei liefert 404, mit Datei Header `Accept-Ranges` und `Cache-Control`.

### 8. Gmail Redirect URI

In der Google Cloud Console beim OAuth-Client `https://video.DEINEDOMAIN.de/api/gmail/callback` als Weiterleitungs-URI eintragen (siehe [docs/gmail-einrichtung.md](docs/gmail-einrichtung.md)). Im Dashboard unter Einstellungen „Gmail verbinden“ und Testmail senden.

### 9. Backup-Cron

`deploy/backup.sh` erstellt einen konsistenten Snapshot der SQLite-Datenbank (`sqlite3 .backup`, Fallback better-sqlite3 im Container), komprimiert ihn nach `/srv/videooutreach/backups/` und behält die letzten 14. Medien sind per Neu-Rendern reproduzierbar und werden nicht gesichert.

```bash
sudo apt install -y sqlite3            # empfohlen
crontab -e
15 3 * * * /srv/videooutreach/deploy/backup.sh >> /srv/videooutreach/backups/backup.log 2>&1
```

Für echte Ausfallsicherheit den Ordner `backups/` zusätzlich extern ablegen (z. B. Hetzner Storage Box, `rsync`) oder Hetzner-Server-Backups aktivieren. Wiederherstellen: `docker compose down`, `gunzip -c backups/app-DATUM.db.gz > data/app.db` (alte `app.db-wal` und `app.db-shm` löschen), `chown 1000:1000 data/app.db`, `docker compose up -d`.

### 10. Updates

```bash
bash /srv/videooutreach/deploy/update.sh   # git pull + fertiges Image laden (nur geänderte Schichten) + Neustart
```

Migrationen laufen beim Start automatisch. Der Worker beendet laufende Jobs sauber (bis 30 s); unterbrochene Renderjobs nimmt er danach wieder auf.

#### Automatisches Deployment per GitHub Action

Bei jedem Push oder Merge auf `main` prüft `.github/workflows/deploy.yml` den Code (Typecheck, Lint, Tests) und baut parallel dazu das Docker-Image auf GitHub-Rechnern, legt es in der GitHub Container Registry (`ghcr.io/amindouioui/videooutreach`) ab und ruft danach per SSH `deploy/update.sh` auf dem VPS auf (git pull, Image laden, Neustart, Health-Check). Der Server baut selbst nichts. Schlägt eine Prüfung fehl, wird nicht ausgerollt. Manuell auslösen: GitHub → Actions → „Prüfen und Deployen“ → „Run workflow“.

Ein normaler Code-Deploy dauert wenige Minuten: Das Image ist in Schichten aufgeteilt, `node_modules` + Chrome (~1,7 GB) liegen in einer eigenen Schicht, die sich nur mit `package-lock.json` ändert und dann schon auf dem Server liegt – geladen wird nur die kleine App-Schicht. Ändern sich Abhängigkeiten, dauert der nächste Deploy einmalig länger.

Den Host-Key des VPS holt der Workflow per `ssh-keyscan` und vergleicht ihn mit `VPS_HOSTKEY_FINGERPRINT` in `deploy.yml` (ändert sich der Host-Key, dort aktualisieren: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`).

Einmalige Einrichtung auf dem Server (als root):

```bash
# 1. Eigenen Deploy-Schlüssel erzeugen (ohne Passphrase)
ssh-keygen -t ed25519 -N "" -C "github-deploy-videooutreach" -f /root/.ssh/videooutreach_deploy

# 2. Schlüssel freischalten – aber NUR für das Update-Skript (Forced Command, keine Shell)
echo "command=\"/srv/videooutreach/deploy/update.sh\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(cat /root/.ssh/videooutreach_deploy.pub)" >> /root/.ssh/authorized_keys

# 3. Werte für die GitHub-Secrets anzeigen
cat /root/.ssh/videooutreach_deploy        # -> VPS_SSH_KEY (kompletter Inhalt inkl. BEGIN/END-Zeilen)
```

Dann in GitHub unter **Settings → Secrets and variables → Actions → New repository secret** anlegen:

| Secret | Wert |
|---|---|
| `VPS_SSH_KEY` | Inhalt von `/root/.ssh/videooutreach_deploy` |
| `VPS_HOST` | optional, Standard `72.61.80.20` |
| `VPS_USER` | optional, Standard `root` |

Der Schlüssel kann wegen des Forced Commands ausschließlich `deploy/update.sh` ausführen – selbst wenn er in falsche Hände gerät, ist damit keine Shell auf dem Server möglich. Die private Datei kann nach dem Eintragen in GitHub auf dem Server gelöscht werden (`rm /root/.ssh/videooutreach_deploy`, die `.pub` und der Eintrag in `authorized_keys` bleiben).

### 11. Logs und Betrieb

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f --tail=200 worker
docker compose restart worker
docker compose down            # stoppen (Daten bleiben in ./data)
```

**Neustart-Verhalten:** Beide Dienste haben `restart: unless-stopped` und starten nach Server-Reboot oder Docker-Neustart automatisch (Docker-Dienst muss aktiviert sein: `sudo systemctl enable docker`). Nach `docker compose down` bleiben sie bis zum nächsten `up -d` aus. Der Worker startet erst, wenn die App gesund ist. Docker-Logs wachsen ohne Begrenzung; bei Bedarf in `/etc/docker/daemon.json` `{"log-driver":"local"}` setzen.

## Fehlerbehebung

| Problem | Ursache / Lösung |
| --- | --- |
| `SQLITE_CANTOPEN` / `EACCES` auf `/data` | Rechte: `sudo chown -R 1000:1000 data` |
| App startet nicht, „Ungültige Umgebungsvariablen“ | Pflichtwerte in `.env` prüfen; Logs: `docker compose logs app` |
| Login klappt, aber man wird sofort ausgeloggt | `APP_URL` ist `https://…`, die Seite aber über HTTP aufgerufen (secure-Cookie); oder Proxy sendet kein `X-Forwarded-Proto` |
| Worker: Chrome startet nicht / `Target closed` | Zu wenig Speicher oder `/dev/shm` (Compose setzt `shm_size: 1gb`); `RENDER_CONCURRENCY=1`, ggf. Swap anlegen |
| Worker wird mit Code 137 beendet | Out-of-Memory; mehr RAM, Swap oder Limit prüfen |
| Videos werden gerendert, aber `/media/...` liefert 404 | Proxy-Pfad `alias`/`root` stimmt nicht mit `./data/media` überein, oder nginx hat keine Leserechte auf `data/` |
| Video spult nicht / lädt nicht auf dem Handy | Proxy liefert `/media/` ohne Range-Support (z. B. über `proxy_pass` mit Puffer); Direktauslieferung verwenden |
| Upload schlägt fehl (413) | `client_max_body_size 6m` im Proxy; Dateien max. 5 MB |
| `redirect_uri_mismatch` bei Gmail | Redirect-URI in der Cloud Console und `GOOGLE_REDIRECT_URI` stimmen nicht exakt überein |
| `invalid_grant` beim Senden | Gmail im Dashboard trennen und neu verbinden |
| Zertifikat wird nicht ausgestellt | DNS-A-Record noch nicht aktiv oder Port 80 gesperrt (`ufw`, Hetzner-Firewall) |
| Port 80/443 belegt beim Start von Caddy-Container | Es läuft schon ein Webserver; Variante A, B (Host) oder C wählen |
| Healthcheck „unhealthy“ | `docker compose logs app`; meist fehlende `.env`-Werte |

## Datenschutz-Hinweise

- Gespeichert werden Firmen-/Kontaktdaten der Leads, Versand- und Tracking-Ereignisse. Rechtsgrundlage und Zulässigkeit der Kaltakquise (insbesondere E-Mail-Werbung nach § 7 UWG) vor Einsatz rechtlich prüfen lassen; das ersetzt keine Rechtsberatung.
- Die Video-Seite setzt keine Cookies und lädt keine Drittanbieter-Skripte. IP-Adressen werden nur gesalzen gehasht gespeichert (`IP_HASH_SALT` geheim halten und nicht ändern, sonst passen alte Hashes nicht mehr).
- Impressum und Datenschutzerklärung müssen verlinkt sein (`IMPRESSUM_URL`, `DATENSCHUTZ_URL`) und das Tracking sowie den Abmeldeweg benennen. Mit dem Hosting-Anbieter (Hetzner) sollte ein Auftragsverarbeitungsvertrag bestehen, ebenso für Google Workspace.
- Abmeldungen landen in einer kampagnenübergreifenden Sperrliste und werden nie wieder angeschrieben. Löschwünsche: Lead im Dashboard löschen und zugehörige Dateien in `data/media/` entfernen.
- OAuth-Tokens sind AES-256-GCM-verschlüsselt in der Datenbank. `.env`, `data/` und `backups/` enthalten Geheimnisse bzw. personenbezogene Daten: Rechte restriktiv halten, nicht ins Repository, Backups verschlüsselt extern ablegen.
- Sicherheit: Port 3000 nur auf `127.0.0.1`, sicheres Admin-Passwort, regelmäßige Updates (`apt upgrade`, `git pull && docker compose up -d --build`).
