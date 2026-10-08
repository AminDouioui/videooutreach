# Technische Spezifikation – Video-Outreach-Dashboard

Diese Datei ist die verbindliche Arbeitsgrundlage für alle Entwickler-Agenten.
Sie ergänzt `BRIEFING.md` (fachliche Anforderungen). Bei Widerspruch gilt SPEC.md.

## Entscheidungen des Auftraggebers

- **Anrede:** allgemein. Excel enthält nur `Name`, `Firma`, `Email`. `Name` ist der volle Name
  („Max Mustermann“) → `vorname` = alles bis zum letzten Wort, `nachname` = letztes Wort.
  `anrede` bleibt leer, Mapping-Option existiert trotzdem.
  Begrüßung überall: `Guten Tag {Vorname} {Nachname}` bzw. `Guten Tag` wenn kein Name.
- **Termin-Link Standard:** `https://calendly.com/sebastian-spuhler/30min` (Vorbelegung bei neuer Kampagne,
  zusätzlich `DEFAULT_CTA_URL` in `.env`).
- **Gmail:** Google-Workspace-Konto `@prozessia.de` (OAuth-Zustimmungsbildschirm „Intern“).
- Deployment (Hetzner, Proxy) wird am Ende geklärt → Docker/Compose + Beispiel-Configs für nginx **und** Caddy liefern.

## Stack (fix)

- Node 22, npm, TypeScript `strict: true`
- Next.js 15 (App Router), Projektwurzel = Repo-Wurzel, Ordner `app/` (kein `src/`)
- Tailwind CSS
- SQLite: `better-sqlite3` + `drizzle-orm`, Migrationen via `drizzle-kit generate` nach `db/migrations`,
  angewendet automatisch beim Start (App und Worker) über `migrate()` in `lib/db.ts`
- ExcelJS (`.xlsx`) + eigener kleiner CSV-Parser oder `papaparse` (`.csv`, Trennzeichen `,` und `;` erkennen)
- Remotion 4 (`remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/cli`, `@remotion/zod-types` optional)
- Worker: `worker/index.ts`, gestartet mit `tsx`
- `googleapis` für Gmail
- `zod` überall für Validierung
- Tests: `vitest` für reine Logik in `lib/`
- Keine weiteren Dienste (kein Redis etc.)

## Verzeichnisstruktur

```
app/
  (dashboard)/            geschützt, eigenes Layout mit Navigation
    page.tsx              Kampagnen-Übersicht
    kampagnen/neu/page.tsx
    kampagnen/[id]/page.tsx          Kampagnen-Detail (Leads-Tabelle)
    kampagnen/[id]/import/page.tsx   Upload + Mapping + Validierung
    kampagnen/[id]/vorlage/page.tsx  Mail-Vorlage + Vorschau + Testmail (Phase 4)
    kampagnen/[id]/einstellungen/... (optional, sonst im Detail)
    leads/[id]/page.tsx              Lead-Detail
    einstellungen/page.tsx           globale Einstellungen + Sperrliste + Gmail
  login/page.tsx
  v/[slug]/page.tsx       öffentliche Video-Seite
  abmelden/[slug]/page.tsx
  media/[file]/route.ts   NUR Fallback für lokale Entwicklung (Range-Requests!), in Produktion liefert der Proxy
  api/
    auth/login, auth/logout
    campaigns/...         Admin-API
    leads/...
    upload/parse          Datei parsen → Spalten + Vorschau + alle Zeilen (Server hält nichts, Client schickt Mapping+Zeilen-Token zurück) – siehe unten
    t/route.ts            Tracking POST (öffentlich)
    o/[file]/route.ts     Öffnungs-Pixel GET /api/o/{slug}.gif (öffentlich)
    gmail/connect, gmail/callback
    unsubscribe/[slug]    One-Click POST (öffentlich)
db/
  schema.ts
  migrations/
lib/
  env.ts        zod-validierte Umgebungsvariablen (lazy, damit `next build` ohne .env durchläuft)
  db.ts         Singleton better-sqlite3 + drizzle + migrate()
  auth.ts       Session-Token (HMAC-SHA256 via Web Crypto, edge-kompatibel), Login-Ratelimit
  slug.ts       Slug-Erzeugung
  crypto.ts     AES-256-GCM für Tokens, IP-Hash (sha256(salt+ip))
  import.ts     Spalten-Erkennung, Mapping, Validierung (reine Funktionen, getestet)
  name.ts       Namens-Split + Begrüßung
  score.ts      Score-Berechnung (rein, getestet)
  bots.ts       Bot-User-Agent-Erkennung
  ratelimit.ts  In-Memory-Ratelimiter
  time.ts       Versandfenster Europe/Berlin (Intl, keine Zusatz-Lib)
  mail.ts       MIME-Aufbau, Platzhalter-Ersetzung (rein, getestet)
  gmail.ts      OAuth-Client, Senden
  media.ts      Pfade: `${DATA_DIR}/media/{slug}.mp4|.jpg`
  settings.ts   Key/Value-Zugriff
middleware.ts   schützt alles außer öffentlichen Pfaden
remotion/
  index.ts      registerRoot
  Root.tsx      Kompositionen OutreachVideo + OutreachThumbnail
  schema.ts     zod-Props-Schema (gemeinsam mit Worker)
  OutreachVideo.tsx, OutreachThumbnail.tsx
worker/
  index.ts      Startet Render- und Versand-Schleife, Recovery, Signal-Handling
  render.ts
  send.ts
deploy/
  nginx.conf.example, Caddyfile.example, backup.sh
data/           (gitignored) lokale DB + media
```

## Umgebungsvariablen

```
APP_URL=http://localhost:3000
ADMIN_PASSWORD=
SESSION_SECRET=            (min. 32 Zeichen)
ENCRYPTION_KEY=            (64 Hex-Zeichen = 32 Byte)
IP_HASH_SALT=
DATA_DIR=./data            (Docker: /data)
RENDER_CONCURRENCY=1
REMOTION_BROWSER_EXECUTABLE=   (optional: Pfad zu Chrome/Chromium, sonst lädt Remotion chrome-headless-shell)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/callback
SENDER_EMAIL=
SENDER_NAME=
DEFAULT_CTA_URL=https://calendly.com/sebastian-spuhler/30min
IMPRESSUM_URL=
DATENSCHUTZ_URL=
SEND_MIN_GAP_MINUTES=3
SEND_MAX_GAP_MINUTES=9
```

`lib/env.ts` muss mit fehlenden Variablen beim Build funktionieren; Fehler erst beim Zugriff werfen.

## Datenmodell (Drizzle, SQLite) – exakt so anlegen

Zeitstempel als `integer` Unix-ms (`mode: 'timestamp_ms'`). Booleans als `integer({ mode: 'boolean' })`.
JSON als `text({ mode: 'json' })`.

**campaigns**: id (int pk autoinc), name, created_at, email_subject_template, email_body_template,
daily_send_limit (default 30), send_window_start (text 'HH:MM', default '08:00'),
send_window_end (default '17:00'), send_weekdays_only (bool default true), cta_url,
tracking_pixel (bool default false),
status (text enum: entwurf | rendert | bereit | versendet_laufend | pausiert | abgeschlossen, default entwurf)

Standard-Vorlagen beim Anlegen:
- Betreff: `Kurzes Video für {{firma}}`
- Text:
```
{{begruessung}},

ich habe für {{firma}} ein kurzes, persönliches Video aufgenommen:

{{vorschaubild}}

Wenn das für Sie interessant ist, freue ich mich über eine kurze Rückmeldung oder einen 15-Minuten-Termin.
```
(Signatur + Abmeldelink werden automatisch angehängt.)

**leads**: id, campaign_id (fk, cascade), firma, anrede, vorname, nachname, email, position, website,
extra (json), slug (unique), render_status (wartet|rendert|fertig|fehler, default wartet), render_error,
video_path, thumbnail_path, rendered_at, send_status (nicht_gesendet|geplant|gesendet|fehler|uebersprungen,
default nicht_gesendet), send_error, sent_at, gmail_message_id, gmail_thread_id,
unsubscribed (bool default false), unsubscribed_at, score (int default 0), notizen (text),
render_requested (bool default false — true = in Render-Warteschlange; „Alle rendern“ setzt es),
created_at. Index auf campaign_id, email.

Hinweis Render-Warteschlange: Nach dem Import steht render_status = `wartet`, aber `render_requested = false`.
Der Worker rendert nur `render_status = 'wartet' AND render_requested = 1`. So rendert nichts ungefragt.

**events**: id, lead_id (fk cascade), type (page_view|play|progress_25|progress_50|progress_75|progress_100|
cta_click|email_open|unsubscribe), meta (json), ip_hash, user_agent, is_bot (bool), created_at. Index lead_id.

**settings**: key (text pk), value (text). Keys: `gmail_refresh_token` (verschlüsselt), `gmail_email`,
`sender_name`, `signature` (Klartext/mehrzeilig), `global_daily_limit` (Standard 30),
`impressum_url`, `datenschutz_url` (überschreiben .env wenn gesetzt), `send_state` (JSON: `{date, sentToday,
nextSendAt, quotaStoppedDate}`).

**suppression_list**: email (text pk, lowercase), reason (text), created_at.

## Kernlogik

### Slug (`lib/slug.ts`)
`slugBase(firma)`: lowercase, ä→ae ö→oe ü→ue ß→ss, andere Diakritika via NFKD entfernen,
Rechtsformen entfernen (Wortgrenzen, nach Normalisierung): `gmbh & co. kg`, `gmbh & co kg`, `gmbh`, `mbh`,
`ag`, `kg`, `ohg`, `gbr`, `e.k.`, `ek`, `e.v.`, `ug (haftungsbeschränkt)`, `ug`, `se`, `kgaa`, `ltd`, `inc`,
`co.`, `& co`… dann alles außer a-z0-9 → `-`, Mehrfach-Bindestriche zusammenfassen, trimmen, auf 30 Zeichen
kürzen (kein Bindestrich am Ende). Leer → `video`.
`createSlug(firma, exists: (s)=>boolean)`: `${base}-${4 zufällige [a-z0-9] via crypto.randomInt}`, bis eindeutig.
Tests: „Musterbau GmbH“→`musterbau-xxxx`, „Müller & Söhne GmbH & Co. KG“→`mueller-soehne-xxxx`, „Straßenbau AG“→`strassenbau-xxxx`.

### Import (`lib/import.ts`)
- `guessMapping(headers)`: Felder `name` (voller Name, Spaltennamen: name, ansprechpartner, kontakt, kontaktperson),
  `vorname`, `nachname`, `anrede`, `firma` (firma, unternehmen, company, firmenname), `email`
  (email, e-mail, mail, e-mail-adresse), `position`, `website` (website, webseite, url, homepage).
  Vergleich case-insensitive, Leerzeichen/Bindestriche ignorieren.
- Mapping: wenn `name` gemappt und vorname/nachname nicht → Split per `lib/name.ts`.
- Nicht gemappte Spalten → `extra`.
- Validierung pro Zeile → Status: `ok` | `ungueltige_email` | `duplikat_datei` | `duplikat_bestand`
  (gleiche E-Mail in irgendeiner Kampagne) | `gesperrt` (Sperrliste) | `fehlende_pflichtfelder` (Firma oder E-Mail leer).
  E-Mails trimmen + lowercase. Erste Vorkommen in Datei ist ok, weitere = duplikat_datei.
- Nur `ok`-Zeilen werden importiert.
- Ablauf UI: Upload → `POST /api/upload/parse` (multipart, max 5 MB, nur .xlsx/.csv, Inhalt prüfen) liefert
  `{ headers, rows: Record<string,string>[] (max 5000), guessedMapping }`. Client zeigt Mapping + 5 Zeilen
  Vorschau → `POST /api/campaigns/[id]/import/validate` `{mapping, rows}` → Zeilen mit Status + Zusammenfassung
  („8 gültig, 1 Duplikat, 1 ungültig“) → `POST /api/campaigns/[id]/import` `{mapping, rows}` (validiert serverseitig
  erneut, importiert ok-Zeilen in einer Transaktion, erzeugt Slugs).

### Score (`lib/score.ts`)
Nur Nicht-Bot-Events. play=10 (einmalig), progress_50=10, progress_100=15, cta_click=30 (einmalig),
+5 je weiterem Kalendertag (Europe/Berlin) mit Nicht-Bot-page_view/play über den ersten hinaus.
progress_25/75 je +0 (oder 5 – egal, dokumentieren). email_open zählt nicht. Score wird bei jedem Event neu berechnet
und in `leads.score` gespeichert.

### Tracking
- `POST /api/t` body `{slug, type, meta?}` (zod), Typen page_view|play|progress_*|cta_click. Akzeptiert JSON
  und `text/plain` (sendBeacon). Antwort 204. Unbekannter Slug → 204 ohne Speichern.
- `is_bot` = UA passt auf Bot-Liste (`lib/bots.ts`: bot, crawler, spider, preview, safelinks, proofpoint,
  mimecast, barracuda, headless, python-requests, curl, wget, go-http, java/, okhttp, microsoft office,
  googleimageproxy (nur bei page_view relevant) …) oder leerer UA.
- `page_view` wird NUR clientseitig per JS gesendet (nicht serverseitig beim Rendern der Seite).
- Ratelimit: max 30 Events / Minute pro (ip_hash, slug); max 1 gleiches progress_/play/cta Event pro Lead pro 10 s.
- Öffnungs-Pixel `GET /api/o/{slug}.gif`: 1×1 transparentes GIF, loggt `email_open` nur wenn Kampagne `tracking_pixel` aktiv.
  `Cache-Control: no-store`.
- IP aus `x-forwarded-for` (erste) / `x-real-ip`, nur gehasht speichern.

### Video-Seite `/v/[slug]`
Server-Komponente lädt Lead+Kampagne; unbekannt → `notFound()` (neutrale 404). Lead gelöscht/Video nicht fertig →
neutraler Hinweis „Video wird vorbereitet“. Metadata `robots: noindex, nofollow`. Keine Cookies, keine Fremd-Skripte,
keine Google-Fonts-Requests zur Laufzeit (System-Font-Stack). Überschrift: „{Begrüßung}, ein Video für {Firma}“.
`<video controls playsInline preload="metadata" poster=/media/{slug}.jpg src=/media/{slug}.mp4>`.
Buttons: „15-Minuten-Termin buchen“ (cta_url, target _blank, sendet cta_click per sendBeacon), „Antworten“ (mailto
SENDER_EMAIL, Betreff „Ihr Video für {Firma}“). Footer Impressum/Datenschutz.
Client-Komponente: page_view beim Mount, play beim ersten play, progress-Schwellen einmalig via timeupdate (100 % auch bei `ended`).
Medien-URLs immer relativ `/media/...` auf der Seite; in Mails absolut `${APP_URL}/media/...`.

### Medien
- `/media/[file]` Route: nur `^[a-z0-9-]+\.(mp4|jpg)$`, liefert aus `${DATA_DIR}/media`, unterstützt Range (206),
  `Accept-Ranges: bytes`, `Cache-Control: public, max-age=31536000, immutable` – ABER beim Neu-Rendern ändert sich der
  Inhalt: deshalb in Seite/Mail `?v={rendered_at}` anhängen.
- Middleware lässt `/media/` öffentlich.

### Auth
- `ADMIN_PASSWORD` Vergleich timing-safe. Session-Cookie `vo_session` = `${expiresMs}.${hmacHex}`, 14 Tage,
  httpOnly, secure (wenn APP_URL https), sameSite lax, path /.
- `middleware.ts` (Edge): öffentlich sind `/login`, `/api/auth/login`, `/v/`, `/abmelden/`, `/media/`, `/api/t`,
  `/api/o/`, `/api/unsubscribe/`, `/_next/`, `/favicon.ico`. Alles andere: ohne gültige Session → Seiten Redirect
  `/login?next=…`, API 401 JSON.
- `/api/gmail/callback` ist geschützt (Admin ist eingeloggt, wenn er OAuth startet). OAuth-`state` = zufälliger Wert im
  httpOnly-Cookie, beim Callback prüfen.
- Login-Ratelimit: 5 Fehlversuche / 15 min pro IP-Hash → 429.

### Worker (`worker/index.ts`)
- Gemeinsame DB über `lib/db.ts` (WAL-Modus, `busy_timeout = 5000`).
- Beim Start: Leads mit `render_status='rendert'` → `wartet` (Recovery). Remotion **einmal** bundeln
  (`bundle({ entryPoint: 'remotion/index.ts' })`), danach Render-Schleife und Versand-Schleife parallel, Polling 3 s.
- Render: bis `RENDER_CONCURRENCY` Jobs gleichzeitig. `selectComposition` + `renderMedia({ codec:'h264', crf: 28,
  imageFormat: 'jpeg', outputLocation: tmp, ... })` dann atomar umbenennen nach `/media/{slug}.mp4`.
  `renderStill` mit `OutreachThumbnail` → `/media/{slug}.jpg` (jpeg, quality 85). `browserExecutable` aus
  `REMOTION_BROWSER_EXECUTABLE` wenn gesetzt. Erfolg → fertig, rendered_at, render_requested=false; Fehler → fehler +
  Meldung (gekürzt 1000 Zeichen). Kampagnen-Status: wenn Kampagne `rendert` und keine Leads mehr wartet+requested →
  `bereit`.
- Versand: siehe Phase 4 unten. SIGTERM/SIGINT: laufende Jobs zu Ende lassen (max. 30 s), dann beenden.
- Ungefangene Fehler loggen, Schleife läuft weiter.

### Remotion
- `remotion/schema.ts`: `outreachPropsSchema = z.object({ firma: z.string(), anrede: z.string().default(''),
  vorname: z.string().default(''), nachname: z.string().default(''), logoUrl: z.string().url().optional(),
  websiteScreenshotUrl: z.string().url().optional() })`.
- `OutreachVideo`: 1280×720, 30 fps, 600 Frames. Platzhalter: animierter Hintergrund, „Guten Tag {Name}“,
  Firmenname groß, ein paar animierte Textabschnitte, Schluss „15-Minuten-Termin buchen“. Nur Remotion-Bordmittel,
  keine externen Assets/Fonts aus dem Netz.
- `OutreachThumbnail`: Still 1280×720 (`<Still>`), Firmenname groß, gut sichtbarer runder Play-Button in der Mitte,
  kleiner Text „Ihr persönliches Video“. Wirkt wie Video-Frame.
- npm-Skripte: `remotion:studio`.

### Gmail-Versand (Phase 4)
- `lib/gmail.ts`: OAuth2-Client (googleapis), Scope nur `https://www.googleapis.com/auth/gmail.send`,
  `access_type=offline`, `prompt=consent`. Refresh-Token AES-256-GCM verschlüsselt in settings. E-Mail-Adresse des
  Kontos: aus `SENDER_EMAIL` (gmail.send erlaubt kein Profil-Lesen).
- `lib/mail.ts` (rein, getestet): `renderTemplate(tpl, vars)`, `buildMime({from, to, subject, html, text,
  listUnsubscribeUrl, listUnsubscribeMailto})` → RFC 2822 `multipart/alternative`, UTF-8, Betreff RFC 2047
  encoded, Body quoted-printable oder base64, Header `List-Unsubscribe: <https://…/abmelden/{slug}>, <mailto:…?subject=Abmelden>`,
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Kein Anhang. Ergebnis base64url für `users.messages.send`.
  One-Click-URL im Header: `${APP_URL}/api/unsubscribe/{slug}` (POST), sichtbarer Link `${APP_URL}/abmelden/{slug}`.
- Platzhalter: `{{begruessung}} {{anrede}} {{vorname}} {{nachname}} {{name}} {{firma}} {{video_link}} {{vorschaubild}}`.
  HTML: Text mit `<br>`/`<p>`, schlicht (Arial/Systemschrift 14px, keine Farben/Boxen). `{{vorschaubild}}` →
  `<a href="video_link"><img src="thumb_url" alt="Video für {Firma} ansehen" width="480" style="max-width:100%;border:0"></a>`
  + darunter `<a href="video_link">Video ansehen: video_link</a>`. Klartext: `{{vorschaubild}}` → `Video ansehen: video_link`.
  Dann Signatur (settings, Zeilenumbrüche erhalten), dann klein: „Keine weiteren E-Mails? Hier abmelden: {link}“.
  Optional Öffnungs-Pixel wenn Kampagne `tracking_pixel`.
- Vorschau-Seite pro Kampagne: Lead auswählen → gerenderte HTML-Mail im iframe (`srcDoc`) + Betreff + Klartext;
  Button „Testmail an mich“ (an SENDER_EMAIL, Betreff mit „[TEST]“).
- Versand-Schleife im Worker:
  - Kampagnen mit status `versendet_laufend`.
  - Kandidaten: send_status in (`nicht_gesendet`,`geplant`), render_status `fertig`, nicht unsubscribed, E-Mail nicht in
    suppression_list (sonst → `uebersprungen` mit Grund).
  - Versandfenster je Kampagne (Europe/Berlin, `lib/time.ts`), Wochentage-only.
  - Globales Tageslimit `global_daily_limit` (settings, Standard 30) UND Kampagnen-`daily_send_limit`
    (gesendet heute in dieser Kampagne). Zählung heute = leads.sent_at heute (Berlin).
  - Zufälliger Abstand SEND_MIN..MAX_GAP_MINUTES: `nextSendAt` in settings `send_state` persistieren.
  - Fehler pro Lead speichern. Quota/RateLimit (HTTP 429, `rateLimitExceeded`, `dailyLimitExceeded`, `quotaExceeded`)
    → `quotaStoppedDate = heute`, Versand heute stoppen, Lead bleibt `geplant`. Ungültige Adresse (400 invalid to) → fehler.
  - Wenn keine Kandidaten mehr in Kampagne → status `abgeschlossen`.
  - „Jetzt senden“ für Einzel-Lead: API ruft gleiche Sendefunktion direkt (ignoriert Fenster/Abstand, zählt aber zum Limit,
    respektiert Sperrliste).
- Kampagnen-Aktionen: „Versand starten“ (Leads nicht_gesendet+fertig → geplant, status versendet_laufend),
  „Pausieren“, „Fortsetzen“.

### Abmeldung
- `/abmelden/[slug]`: Seite mit Button „Keine weiteren E-Mails erhalten“ (Form POST an Server Action oder
  `/api/unsubscribe/[slug]`), danach Bestätigung. GET allein meldet NICHT ab (Scanner!).
- `POST /api/unsubscribe/[slug]`: One-Click, setzt unsubscribed, unsubscribed_at, suppression_list (reason
  `abmeldung`), Event `unsubscribe`, ausstehende Mails des Leads → `uebersprungen`. Antwort 200 Text bzw. Redirect zur
  Bestätigung bei Formular-Submit. Keine Cookies, kein CSRF-Token nötig (öffentliche Aktion, idempotent).
- Sperrliste gilt kampagnenübergreifend (Versand + Import).

### Dashboard
- Übersicht: Kampagnen-Karten/Tabelle mit Kennzahlen: Leads, gerendert, gesendet, Seitenaufrufe (Nicht-Bot page_view),
  Videostarts, Ø Sehdauer (Ø max. Fortschritt in % der Leads mit Play), Termin-Klicks, Abmeldungen.
- Kampagnen-Detail: Kopf mit Status, Fortschritt „143 / 200 gerendert“ (Polling alle 3 s über
  `GET /api/campaigns/[id]/status` solange gerendert wird), Aktionen: Leads importieren, Alle rendern, Fehlgeschlagene
  erneut rendern, Versand starten/pausieren/fortsetzen, Vorlage bearbeiten, CSV-Export, Kampagnen-Einstellungen
  (Name, cta_url, Limits, Fenster, Pixel).
  Tabelle: Firma · Ansprechpartner · E-Mail · Render-Status · Versand-Status · Gesendet am · Aufrufe · Angeschaut (max %) ·
  Termin-Klick · Score · Link (kopierbar) · Aktionen. Sortierbar (Spaltenklick), Filter (alle, mit Play, nicht gesendet,
  Fehler, Termin-Klick), Suche Firma/E-Mail. Standard: Score absteigend. Clientseitig sortieren/filtern reicht (bis ~5000 Leads).
- Lead-Detail: Video (`<video>`), Vorschaubild, Event-Zeitleiste (Bot-Events grau + „Bot“), Mail-Vorschau (iframe),
  Notizfeld (speichern), Aktionen: neu rendern, jetzt senden, überspringen, löschen (inkl. Mediendateien, Bestätigung).
- CSV-Export: `GET /api/campaigns/[id]/export.csv`, Trennzeichen `;`, UTF-8 mit BOM (Excel), alle Lead-Felder + Kennzahlen.
- Einstellungen: Gmail verbinden/trennen (Status), Absendername, Signatur, globales Tageslimit, Impressum-/Datenschutz-URL,
  Sperrliste (Liste, hinzufügen, entfernen).
- E-Mail-Öffnungen im Dashboard nur mit Hinweis „unzuverlässig“.

## UI-Richtlinien
- Deutsch, schlicht, professionell: weißer Hintergrund, `slate`-Grautöne, eine Akzentfarbe (`indigo-600`), Tabellen
  kompakt, Status als kleine farbige Badges. System-Font-Stack (kein next/font Download nötig).
- Keine UI-Komponentenbibliothek nötig; kleine eigene Komponenten unter `components/`.
- Server Components + Server Actions oder Route Handler – beides ok, aber konsistent; Mutationen validieren mit zod.

## Qualität
- `npm run typecheck` (tsc --noEmit), `npm run lint` (next lint oder eslint), `npm test` (vitest), `npm run build`
  müssen grün sein.
- `.gitignore`: node_modules, .next, data/, .env, out, *.log.
- Code-Kommentare Deutsch.
