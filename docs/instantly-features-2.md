# Instantly-Funktionen, Runde 2 – Entwicklungsplan

Fortsetzung von `docs/instantly-features.md`. Ziel: die noch fehlenden bzw. nur teilweise vorhandenen Instantly-Funktionen,
soweit sie sich selbst gehostet sinnvoll umsetzen lassen.

## Bewusst NICHT umgesetzt

| Funktion | Grund |
| --- | --- |
| Aufwärm-Netzwerk (Postfächer schreiben sich gegenseitig) | Braucht ein Netzwerk aus tausenden fremden Postfächern. Mit wenigen eigenen Postfächern wirkungslos bis schädlich. Ersatz: Aufwärmrampe (vorhanden). |
| Lead-Datenbank (B2B-Kontaktsuche) | Externer Datenbestand, nicht selbst herstellbar. |
| SMTP-Prüfung einzelner Adressen | Braucht ausgehenden Port 25 (bei Hetzner Cloud standardmäßig gesperrt) und schadet dem Ruf der Server-IP. Ersatz: MX-Prüfung (vorhanden) + Bounce-Schutz. |

## Arbeitsweise

Pro Paket: Entwicklung (Subagent) → UI-Test mit Playwright gegen lokale Instanz (Subagent) → Fehler beheben → erneut testen,
bis grün. Pakete nacheinander (Migrationen). Am Ende kompletter Regressionstest, Merge auf `main`, Deploy.
Neue npm-Abhängigkeiten nur wo unvermeidbar (SMTP/IMAP) und dann etablierte Pakete.

## Paket 7 – Abwesenheitsnotizen & Bounce-Schutz

- Antwort-Erkennung unterscheidet **Abwesenheitsnotiz** (Header `Auto-Submitted`, `X-Autoreply`, `X-Autorespond`,
  `Precedence: auto_reply/bulk`, Betreff-Muster „Abwesenheit“, „Out of Office“, „Automatische Antwort“ …) von echter
  Antwort. Abwesenheit stoppt den Flow nicht (Kampagnen-Option „bei Abwesenheit pausieren bis …“ optional: Follow-up
  um N Tage verschieben). Neuer Event/Status sichtbar im Lead.
- **Bounce-Schutz**: Kampagne pausiert automatisch, wenn Bounce-Quote der letzten N Erstmails (Standard 50) > Schwelle
  (Standard 5 %). Postfach pausiert, wenn seine Bounce-Quote zu hoch ist. Hinweis im Dashboard.

## Paket 8 – A/B-Varianten für Follow-ups

- Varianten je Follow-up-Schritt (Text, optional eigener Betreff = neuer Thread statt „Re:“). Zuweisung rotierend,
  Statistik je Schritt und Variante in der Analyse.

## Paket 9 – Zeitzonen je Lead

- `leads.zeitzone` (IANA). Import-Spalte „Zeitzone“/„Land“; sonst aus Länder-TLD der Website/E-Mail geschätzt,
  Standard = Kampagnen-Zeitzone. Kampagne bekommt `zeitzone` (Standard Europe/Berlin). Versandfenster und -tage
  gelten in der Zeitzone des Leads (Instantly-Verhalten). Tageslimits zählen weiter nach Berlin-Tag.

## Paket 10 – Klick-Tracking für Links in Mails (optional je Kampagne)

- Links im Mailtext werden über `/api/c/<token>` umgeleitet (Event `link_click` mit Ziel-URL, Bot-Erkennung).
  Standard aus (schadet Zustellbarkeit leicht – Hinweis in der UI). Score + Analyse.

## Paket 11 – Unibox: Antworten lesen und beantworten

- Neuer optionaler Scope `gmail.readonly` je Postfach („Lesezugriff erteilen“ = neu verbinden). Mit Lesezugriff:
  `/antworten` zeigt den Thread-Verlauf (Text, bereinigt, kein externes HTML/Bilder laden), Antworten direkt aus der App
  (über `gmail.send` im selben Thread, mit Signatur des Postfachs). Ohne Lesezugriff bleibt der Gmail-Link.
- Sicherheit: HTML der Mails nie ungefiltert rendern (nur Text bzw. sicher escaped).

## Paket 12 – KI-Funktionen (optional, nur mit `ANTHROPIC_API_KEY`)

- Ohne Schlüssel ist alles aus und unsichtbar. Mit Schlüssel:
  - Antworten automatisch einordnen (interessiert / nicht interessiert / später / falscher Ansprechpartner /
    Abwesenheit / Abmeldung) → Lead-Status-Vorschlag bzw. automatisch (Einstellung).
  - Schreibhilfe im Vorlagen-Editor: Betreff/Text-Vorschläge und Spintax-Varianten aus einer Kurzbeschreibung.
  - Antwort-Entwurf in der Unibox.
- Datenschutz-Hinweis in README (Daten gehen an Anthropic).

## Paket 13 – Pipeline (CRM light) & Untersequenzen

- Deal-Wert (€) und Notiz je Lead, Kanban-Ansicht `/pipeline` nach Lead-Status (Drag-and-drop ohne Lib, Fallback
  Dropdown), Summen je Spalte.
- **Untersequenzen**: Regel je Kampagne „Wenn Lead-Status = X → in Kampagne Y übernehmen“ (Lead wird kopiert,
  Flow startet dort neu; Sperrliste/Abmeldung gelten).

## Paket 14 – Webhooks & API

- Ausgehende Webhooks (URL, Ereignisse: antwort, lead_status, video_angesehen, termin_klick, bounce, abmeldung),
  HMAC-Signatur, Wiederholung mit Backoff im Worker, Protokoll der letzten Zustellungen.
- REST-API mit API-Schlüsseln (gehasht gespeichert): Kampagnen lesen, Leads anlegen/lesen, Lead-Status setzen.
  Kurze API-Doku in `docs/api.md`.

## Paket 15 – Team-Zugänge

- Tabelle `benutzer` (E-Mail, Name, Passwort-Hash scrypt, Rolle `admin` | `mitglied` | `lesen`). Der bisherige
  `ADMIN_PASSWORD`-Login bleibt als Admin-Zugang erhalten. Admin lädt Benutzer ein (Einmal-Link), Rollenrechte in
  Middleware/Routen, Anzeige „angemeldet als“.

## Paket 16 – Weitere Postfach-Anbieter (SMTP/IMAP)

- Postfach-Typ `smtp`: SMTP-Versand (nodemailer), IMAP für Antwort-/Bounce-/Abwesenheits-Erkennung (imapflow),
  Zugangsdaten verschlüsselt. Damit gehen Outlook (mit App-Passwort bzw. SMTP AUTH), IONOS, Strato usw.
  Rotation, Limits, Unibox gelten genauso.
