# Video-Outreach-Dashboard

Selbst gehostete Web-App für personalisierte Video-Kaltakquise: Leads importieren, pro Lead ein Video rendern (Remotion), gedrosselt per Gmail versenden und das Verhalten auf der Video-Seite tracken. Fachliche Anforderungen: `BRIEFING.md`, technische Vorgaben: `SPEC.md`.

Stand: **Phase 1** (Grundgerüst, Login, Kampagnen, Import). Rendern, Video-Seite, Tracking, Gmail-Versand und Deployment folgen in späteren Phasen und erweitern dieses README.

## Setup

Voraussetzungen: Node 22, npm.

```bash
npm install
cp .env.example .env      # Werte eintragen (siehe unten)
npm run dev               # http://localhost:3000
```

Secrets erzeugen:

```bash
openssl rand -hex 32      # für SESSION_SECRET und ENCRYPTION_KEY (je ein eigener Wert)
```

Die SQLite-Datenbank (`DATA_DIR/app.db`) und das Medienverzeichnis (`DATA_DIR/media`) werden beim ersten Zugriff automatisch angelegt; Migrationen aus `db/migrations` werden automatisch angewendet.

## Lokale Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Next.js-Entwicklungsserver |
| `npm run build` / `npm start` | Produktions-Build / -Server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm test` | Vitest (Logik in `lib/`) |
| `npm run db:generate` | Neue Drizzle-Migration aus `db/schema.ts` erzeugen |
| `npm run worker` | Worker-Prozess (Phase 1: Stub, öffnet nur die DB) |
| `npm run remotion:studio` | Platzhalter (Phase 2) |
| `npm run fixtures` | Test-Dateien `test/fixtures/leads-test.{xlsx,csv}` neu erzeugen |

Ablauf zum Ausprobieren: anmelden, „Neue Kampagne“ anlegen, `test/fixtures/leads-test.xlsx` hochladen, Spalten prüfen, „Prüfen“, importieren (erwartet: 8 gültig, 1 Duplikat, 1 ungültige E-Mail).

Lokal liefert `app/media/[file]/route.ts` die Mediendateien aus `DATA_DIR/media` (mit Range-Unterstützung). In Produktion übernimmt das der Reverse Proxy.

## Umgebungsvariablen

Siehe `.env.example` (alle Variablen kommentiert). Pflicht: `ADMIN_PASSWORD`, `SESSION_SECRET` (min. 32 Zeichen), `ENCRYPTION_KEY` (64 Hex-Zeichen), `IP_HASH_SALT`. Fehlende Variablen führen erst beim Zugriff zu einem Fehler, `next build` funktioniert auch ohne `.env`.

| Variable | Bedeutung |
| --- | --- |
| `APP_URL` | Basis-URL; `https://` aktiviert das `secure`-Flag am Session-Cookie |
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Admin-Login und Session-Signatur |
| `ENCRYPTION_KEY`, `IP_HASH_SALT` | Verschlüsselung der OAuth-Tokens, gesalzene IP-Hashes |
| `DATA_DIR` | Datenverzeichnis (Standard `./data`, Docker `/data`) |
| `RENDER_CONCURRENCY`, `REMOTION_BROWSER_EXECUTABLE` | Rendering (ab Phase 2) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SENDER_EMAIL`, `SENDER_NAME` | Gmail (ab Phase 4) |
| `DEFAULT_CTA_URL` | Vorbelegung des Termin-Links bei neuen Kampagnen |
| `IMPRESSUM_URL`, `DATENSCHUTZ_URL` | Footer der Video-Seite |
| `SEND_MIN_GAP_MINUTES`, `SEND_MAX_GAP_MINUTES` | Abstand zwischen Mails |

## Sicherheit (Stand Phase 1)

- Alle Seiten und APIs außer den öffentlichen Pfaden (`/login`, `/v/`, `/abmelden/`, `/media/`, `/api/t`, `/api/o/`, `/api/unsubscribe/`) erfordern eine Session (HMAC-signiertes Cookie `vo_session`, 14 Tage).
- Login: höchstens 5 Fehlversuche pro 15 Minuten und IP-Hash (danach 429).
- Upload: nur `.xlsx`/`.csv`, max. 5 MB, Inhalt wird serverseitig geprüft.

## Deployment

Folgt in einer späteren Phase (Docker, Compose, nginx/Caddy, Backup).
