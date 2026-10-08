# Briefing: Video-Outreach-Dashboard (Originalanforderung des Auftraggebers)

Selbst gehostete Web-App für personalisierte Video-Kaltakquise an Einkaufsleiter:

1. Excel-Liste mit Leads (Firma, Ansprechpartner, E-Mail) im Dashboard hochladen.
2. Pro Lead mit Remotion ein personalisiertes Video + Vorschaubild rendern.
3. Jeder Lead bekommt einen nicht erratbaren Link, z.B. `https://video.DOMAIN.de/v/musterbau-k7f3`.
4. Gedrosselter Versand über die Gmail-API. Kein Video-Anhang, sondern klickbares Vorschaubild mit Play-Button.
5. Video-Seite trackt Öffnen, Play, Sehfortschritt, Termin-Klick. Dashboard zeigt das pro Lead, heiße Leads oben.

Läuft auf Hetzner Cloud (Ubuntu) neben einer bestehenden Website, eigene Subdomain, bestehende Website darf nicht beeinträchtigt werden.

## Arbeitsweise
- So einfach wie möglich: kein Redis, kein Kubernetes, keine externen Dienste außer Gmail-API. Ein Server, eine SQLite-DB, ein Worker-Prozess.
- TypeScript überall, strikt.
- `README.md` (Setup, lokale Entwicklung, Deployment, Umgebungsvariablen) und `.env.example` pflegen.
- Keine Secrets im Code/Repo.
- Code-Kommentare und UI-Texte auf Deutsch.

## Datenmodell, Funktionen, Sicherheit
Siehe SPEC.md (vollständig übernommen und präzisiert). Zusätzliche Originalpunkte:

### Login
Ein Admin-Zugang (`ADMIN_PASSWORD`), Session-Cookie httpOnly/secure/SameSite=Lax, Login, Logout. Öffentlich nur `/v/[slug]`, `/abmelden/[slug]`, `/media/*`, Tracking-Endpunkte.

### Upload
Drag-and-drop `.xlsx`/`.csv`, Spalten-Mapping mit Vorschau der ersten 5 Zeilen und geratenen Vorbelegungen, Validierung (ungültige E-Mails, Duplikate in Datei und Bestand, Sperrliste, fehlende Firma/E-Mail), Zusammenfassung („187 gültig, 6 Duplikate, 2 ungültig“), dann Import.

### Rendern
Platzhalter-Komposition `OutreachVideo` (~20 s, 1280×720, 30 fps, Firmenname groß), `OutreachThumbnail` mit Play-Button und Firmenname. Worker bundelt einmal, rendert H.264 720p (< ~10 MB/min), Concurrency per .env (Standard 1), Recovery hängender Jobs. Dashboard-Buttons: „Alle rendern“, „Fehlgeschlagene erneut rendern“, „Dieses Video neu rendern“. Fortschritt per Polling.

### Medien
`/media/{slug}.mp4|.jpg`, in Produktion direkt über Reverse Proxy aus `/data/media`, Range-Requests, lange Cache-Header.

### Video-Seite
Überschrift mit Begrüßung + Firma, HTML5-Player mit Poster, kurzer Text, Button „15-Minuten-Termin buchen“, Button „Antworten“ (mailto), Footer Impressum/Datenschutz, noindex/nofollow, mobil einwandfrei, schnell.

### Tracking
`POST /api/t`, sendBeacon, page_view nur per JS, Bot-Erkennung (Safe Links, Proofpoint, Mimecast …), optionales Öffnungs-Pixel (Standard aus, im Dashboard „unzuverlässig“), Ratelimit, Score (play 10, progress_50 10, progress_100 15, cta_click 30, +5 je weiterem Besuchstag).

### Gmail
OAuth (nur `gmail.send`), verschlüsselter Refresh-Token, README-Anleitung Google Cloud Console. Vorlagen mit Platzhaltern, Vorschau, Testmail. multipart/alternative, schlichtes HTML, kein Anhang, Signatur mit Impressumsangaben, Abmeldelink, `List-Unsubscribe` + `List-Unsubscribe-Post`. Warteschlange: nur fertig gerenderte, nicht gesperrte Leads; Versandfenster (Standard Mo–Fr 08–17 Uhr Europe/Berlin); Tageslimit (Standard 30, über alle Kampagnen); zufälliger Abstand 3–9 min; Pausieren/Fortsetzen; Fehler pro Lead; Quota-Fehler stoppt Versand für den Tag; Message-/Thread-ID speichern.

### Abmeldung
Seite mit Bestätigungsbutton, One-Click per POST, Sperrliste kampagnenübergreifend.

### Dashboard
Übersicht mit Kennzahlen, Kampagnen-Detail mit sortier-/filterbarer Tabelle (Standard Score absteigend), Suche, Lead-Detail mit Event-Zeitleiste (Bots grau), Mail-Vorschau, Notizen, Aktionen, CSV-Export, Einstellungen.

### Sicherheit
Nicht erratbare Slugs, IP nur gesalzen gehasht, keine Drittanbieter-Tracker/Cookies auf öffentlichen Seiten, Login-Versuche begrenzen, Upload-Typ/Größe begrenzen + serverseitig prüfen, Medien/DB außerhalb Web-Root, OAuth-Tokens verschlüsselt.

### Deployment
Dockerfile(s) für App und Worker (Worker mit allen Remotion-Linux-Abhängigkeiten laut aktueller Remotion-Doku), `docker-compose.yml` (Services `app`, `worker`, Volume `/data`, `restart: unless-stopped`), Reverse-Proxy-Einbindung (Konfiguration der bestehenden Website NICHT ändern ohne Rückfrage), tägliches SQLite-Backup (14 behalten), README „Deployment“ Schritt für Schritt inkl. DNS und Update (`git pull && docker compose up -d --build`).

## Abnahmekriterien
1. Test-Excel mit 10 Zeilen (1 Duplikat, 1 ungültige Mail) → Warnungen, Import → 8 Leads mit korrekten Slugs.
2. „Alle rendern“ → Fortschritt sichtbar, MP4 + JPG je Lead in `/data/media`, Thumbnail zeigt Firmenname + Play-Button.
3. Link auf Handy öffnen, bis zur Hälfte schauen, Termin klicken → Events in richtiger Reihenfolge, Lead oben.
4. Testmail kommt an, persönliche Optik, klickbares Vorschaubild, kein Anhang. Abmeldelink funktioniert, Adresse wird nie wieder angeschrieben.
5. App läuft unter Subdomain, bestehende Website unverändert, Neustart bringt App + Worker hoch.
