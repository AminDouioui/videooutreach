# Video-Outreach-Dashboard

Selbst gehostete Web-App für personalisierte Video-Kaltakquise: Leads importieren, pro Lead ein Video rendern (Remotion), gedrosselt per Gmail versenden und das Verhalten auf der Video-Seite auswerten. Fachliche Anforderungen: `BRIEFING.md`, technische Vorgaben: `SPEC.md`.

## Inhalt

1. [Überblick](#überblick) · 2. [Funktionen](#funktionen) · 3. [Architektur](#architektur) · 4. [Lokale Entwicklung](#lokale-entwicklung) · 5. [Umgebungsvariablen](#umgebungsvariablen) · 6. [Gmail-Einrichtung](#gmail-einrichtung) · 7. [Versandregeln](#versandregeln) · 8. [Tracking, Bot-Erkennung, Score](#tracking-bot-erkennung-und-score) · 9. [Rendern mit Remotion](#rendern-mit-remotion) · 10. [Deployment](#deployment) · 11. [Fehlerbehebung](#fehlerbehebung) · 12. [Datenschutz](#datenschutz-hinweise)

## Überblick

Ablauf: Excel/CSV mit Leads hochladen, pro Lead entsteht ein eigenes Video (personalisiertes Intro mit Firmenname + Teaser) samt Vorschaubild. Jeder Lead bekommt eine nicht erratbare Video-Seite `https://video.DEINEDOMAIN.de/v/<slug>`. Die E-Mail mit klickbarem Vorschaubild geht über die Gmail-API raus, das Dashboard zeigt, wer das Video angeschaut und den Termin-Button geklickt hat.

## Funktionen

- Login mit Admin-Passwort (`ADMIN_PASSWORD`, E-Mail-Feld leer lassen), Kampagnen, Vorlagen mit Platzhaltern, Vorschau, Testmail.
- Vorlagen: Spintax `{Hallo|Guten Tag}` (verschachtelbar, pro Lead stabil gewählt, auch in Betreff/Follow-ups), eigene Variablen aus nicht zugeordneten Import-Spalten (`{{stadt}}`, normalisiert), zusätzlich `{{position}}`, `{{website}}`, `{{email}}`, `{{absender_name}}`, und Fallbacks `{{vorname|Hallo zusammen}}`. Editor zeigt Variablen, Hilfe und Warnungen; unbalancierte Klammern verhindern das Speichern.
- A/B-Tests: Die Kampagnen-Vorlage ist Variante A, auf der Vorlagen-Seite kommen bis zu vier weitere Varianten (B–E, je Betreff + Text, aktiv/inaktiv) dazu. Jede Erstmail geht gleichmäßig rotierend mit der Variante raus, die bisher am seltensten gesendet wurde (`leads.variante`); Follow-ups nutzen den Betreff der Variante des Leads. Auswertung je Variante (gesendet, Video-Seite, Play, Termin-Klick, Antworten, Raten) auf der Kampagnenseite, Variante auch im CSV-Export.
- A/B-Varianten für Follow-ups: Je Follow-up-Schritt bis zu fünf Varianten (A = Text des Schritts, B–E zusätzlich, aktiv/inaktiv, Tabelle `followup_varianten`). Zuweisung rotierend nach den wenigsten Versendungen des Schritts (`sent_messages.variante`, gleiche Auswahlfunktion wie bei der Erstmail). Optionaler eigener Betreff je Variante: gesetzt = Mail geht als **neuer Thread** raus (ohne In-Reply-To/References, ohne „Re:“), leer = „Re: …“ im Thread der Erstmail. `leads.gmail_thread_id` bleibt die der Erstmail; jede gesendete Mail speichert ihre Thread-ID in `sent_messages`, und die Antwort-/Bounce-/Abwesenheits-Erkennung prüft alle Threads des Leads (eine echte Antwort in irgendeinem Thread beendet den Flow, `leads.antwort_thread_id` verlinkt den richtigen Thread). Analyse: Schritt-Tabelle mit Zeilen je Variante (gesendet, Antworten danach, Rate).
- Lead-Status (offen, interessiert, Termin gebucht, später, nicht interessiert, falscher Ansprechpartner, gewonnen, verloren): im Lead-Detail, Postfach und per Filter nutzbar, im CSV-Export enthalten. Termin gebucht, nicht interessiert, falscher Ansprechpartner, gewonnen und verloren beenden den Flow (`flow_stopp = 'status'`, offene Erstmail wird übersprungen); zurück auf „offen“ hebt nur diesen Status-Stopp auf, nicht Antwort/Bounce/Abmeldung.
- Antworten-Postfach `/antworten`: alle erkannten Antworten aller Kampagnen (neueste zuerst, ungelesen/alle, nach Lead-Status), Link „In Gmail öffnen“, Status setzen, gelesen markieren; Zähler ungelesener Antworten in der Navigation. Erkannt werden nur Antworten (Gmail-Scope `gmail.metadata`), nicht deren Inhalt.
- Unibox (optional, je Postfach „Lesezugriff erteilen“ = Scope `gmail.readonly`, in Workspace-Apps vom Typ „Intern“ ohne Google-Prüfung nutzbar): `/antworten` zeigt Liste links und Thread rechts (mobil: Liste → Detail), Verlauf als reiner Text (HTML wird nie gerendert, keine Bilder/Links werden geladen; zitierter Verlauf einklappbar; Parser in `lib/mail-parse.ts`, 60 s Cache je Thread) und ein Antwortfeld. Antworten gehen über `POST /api/leads/[id]/antworten` im selben Thread (In-Reply-To/References auf die letzte fremde Nachricht, „Re: …“) über das Postfach des Leads (keine Rotation), mit dessen Signatur, ohne Abmeldelink im Text und ohne Tracking. Sie werden in `sent_messages` mit `step = -1` protokolliert und zählen **nicht** gegen Kampagnen-, Tages- oder Postfach-Limits, die Aufwärmrampe und die Analyse (keine Follow-ups). Ohne Lesezugriff bleiben Hinweis und Gmail-Link; auch im Lead-Detail steht dann ein Abschnitt „Verlauf“. Keine Schemaänderung nötig.
- Firmen-Stopp (Kampagnen-Einstellung, Standard an): Antwortet ein Kontakt, werden die anderen Leads der Kampagne mit gleicher E-Mail-Domain gestoppt (`flow_stopp = 'firma_beantwortet'`, offene Erstmails übersprungen). Freemail-Domains (gmail.com, gmx.de, web.de … siehe `lib/lead-status.ts`) sind ausgenommen.
- Leads-Seite `/leads`: kampagnenübergreifende Suche und Filter (Kampagne, Lead-Status, Versandstatus, beantwortet), Sortierung nach Score/Datum, serverseitig paginiert (100 pro Seite).
- Analyse: je Kampagne `/kampagnen/[id]/analyse` (Kennzahlen, Trichter Leads → gesendet → Video-Seite → Play → 50 % → 100 % → Termin-Klick → Antwort, Bounces, Abmeldungen, Lead-Status, Tabelle je Schritt mit Antworten nach Schritt, Tagesverlauf 30 Tage, A/B-Vergleich); Startseite mit globalen Kennzahlen und 14-Tage-Verlauf; Kampagnenliste mit Antwortrate. Raten beziehen sich auf gesendete Erstmails, Bots sind ausgenommen. Logik in `lib/analyse.ts`.
- Import `.xlsx`/`.csv` mit Spalten-Mapping, Validierung (ungültige E-Mails, Duplikate, Sperrliste inkl. Domain-Sperren) und MX-Prüfung der Domains (siehe „Versandregeln“).
- Zeitplan: frei wählbare Versandtage (Mo–So), optionales Startdatum, „Neue Leads pro Tag“ je Kampagne, globale Aufwärmrampe (Einstellungen); Kampagne duplizieren (Vorlage, Einstellungen, Follow-ups, Varianten, ohne Leads).
- Zeitzonen je Lead: Kampagne hat eine Zeitzone (Standard Europe/Berlin), Leads optional eine eigene (Import-Spalte „Zeitzone“/„Land“ oder Schätzung aus der Länder-Endung von Website/E-Mail, z. B. .at, .ch, .co.uk; .com/.de/.net = Kampagnen-Zeitzone; im Lead-Detail änderbar). Versandfenster und -tage gelten in der Ortszeit des Leads, Tageslimits zählen weiter nach Berliner Tag.
- Rendern aller Leads, nur fehlgeschlagener oder einzelner Leads neu; Fortschritt im Dashboard.
- Öffentliche Video-Seite (mobil, ohne Cookies/Fremd-Skripte, `noindex`).
- Versand mit Warteschlange, Versandfenster, Tageslimit, zufälligem Abstand, Pausieren/Fortsetzen.
- Mehrere Absender-Postfächer (Einstellungen → Postfächer): Erstmails rotieren über die aktiven Postfächer, Abstand, Tageslimit, Quota-/Auth-Fehler und Aufwärmrampe gelten je Postfach; Follow-ups und Antwort-Erkennung laufen immer über das Postfach der Erstmail. Eigener Name und eigene Signatur je Postfach, Postfach-Spalte bei Leads, Tabelle „Postfächer“ in der Kampagnen-Analyse.
- Abwesenheitsnotizen: Die Thread-Prüfung unterscheidet automatische Antworten (Header `Auto-Submitted` ≠ `no`, `X-Autoreply`, `X-Autorespond`, `Precedence: auto_reply/bulk/junk`, Betreff-Muster in de/en/fr/es/it/nl; `X-Auto-Response-Suppress` nur zusammen mit passendem Betreff) von echten Antworten und Bounces (Bounce hat Vorrang). Eine Abwesenheit stoppt den Flow nicht und zählt nicht als Antwort (kein Antworten-Postfach, kein Firmen-Stopp); die Follow-ups des Leads warten stattdessen `abwesenheitVerschiebenTage` (Kampagnen-Einstellung, Standard 7, 0 = nicht verschieben, `leads.abwesendBis`). Badge „Abwesend“ in Lead-Tabellen und Lead-Detail, Event `abwesenheit` in der Zeitleiste, Kennzahl „Abwesenheiten“ in der Analyse. Eine spätere echte Antwort im selben Thread wird weiter erkannt. Erkennung rein in `lib/autoreply.ts` (nur Header, `Subject` wird zusätzlich abgefragt).
- Bounce-Schutz: Nach jedem erkannten Bounce wird die Bounce-Quote der letzten N gesendeten Erstmails (Kampagnen-Einstellung, Standard 50; erst ab 20 gesendeten) mit der Schwelle (Standard 5 %) verglichen; darüber wird die Kampagne pausiert (`campaigns.pausiertGrund`, Hinweis-Banner auf Kampagnen- und Startseite, „Fortsetzen“ löscht den Grund). Ebenso je Postfach (letzte 50 Erstmails, Schwelle global unter Einstellungen): Postfach `aktiv = false` mit Fehler „Bounce-Quote zu hoch (x %)“; wieder aktivieren löscht den Grund. Abschaltbar je Kampagne. Berechnung in `lib/bounce-schutz.ts`, Pausieren in `lib/bounce-schutz-db.ts`.
- Abmeldelink (Seite + One-Click per `List-Unsubscribe-Post`), kampagnenübergreifende Sperrliste.
- Klick-Tracking für Links in Mails (Kampagnen-Einstellung, Standard aus): http(s)-Links im Mailtext laufen über `/api/c/<token>` (Event `link_click` mit Ziel-URL, Bot-Erkennung, Score +10 einmalig, Kennzahl „Link-Klick“ in der Analyse). Nicht umgeleitet werden Video-Link, Vorschaubild, Abmeldelink, Signatur und `mailto:`. Getrackte Links können die Zustellbarkeit leicht verschlechtern.
- KI-Funktionen (optional, für die Einordnung mit `ANTHROPIC_API_KEY` oder `OPENROUTER_API_KEY` (Jev), für Antwort-Entwürfe und Schreibhilfe mit `OPENAI_API_KEY` oder `ANTHROPIC_API_KEY`; ohne Schlüssel sind alle Buttons unsichtbar, die Routen unter `/api/.../ki/*` antworten mit 404 und es gehen keine Anfragen raus). Client `lib/ki.ts` über das offizielle SDK `@anthropic-ai/sdk` (einzige neue Abhängigkeit; Zeitlimit 30 s, strukturierte Ausgabe per `output_config.format`, deutsche Fehlertexte für Rate-Limit, Überlast und ungültigen Schlüssel, kein Logging von Mailinhalten):
  - **Antworten einordnen** (Modell Haiku oder Jev, siehe unten): Wird eine Antwort erkannt und das Postfach hat Lesezugriff, ordnet der Worker die letzte fremde Nachricht (Text ohne Zitat, höchstens ~4000 Zeichen) ein: interessiert, später, nicht interessiert, falscher Ansprechpartner, Abwesenheit, Abmeldung oder sonstiges, mit Konfidenz und Ein-Satz-Begründung (`leads.ki_einordnung`). Einstellung `ki_auto_status` (Einstellungen): *aus*, *vorschlagen* (Standard, Anzeige mit „Vorschlag übernehmen“) oder *automatisch* (nur bei Konfidenz ≥ 0,8): setzt den Lead-Status (nur wenn er noch „Offen“ ist), sperrt Abmeldungen wie den Abmeldelink und behandelt Abwesenheit wie die Abwesenheitserkennung (Flow läuft weiter, Follow-ups warten). KI-Fehler blockieren die Antwort-Erkennung nie; fehlgeschlagene Einordnungen werden höchstens 3x mit wachsender Wartezeit wiederholt. Manuell: „Mit KI einordnen“ in Unibox und Lead-Detail.
  - **Jev als Klassifizierer** (`lib/ki-jev.ts`): Alternativ zu Claude kann die Einordnung mit „Jev“ (TypeSafe AI, Modell `typesafe/jev-1.13`) über OpenRouter laufen (`POST {JEV_BASE_URL}/alpha/decisions`, Frage vom Typ `choice` mit deutschen Kriterien-Beschreibungen, nur über `fetch`, keine neue Abhängigkeit). Jev liefert keinen Text: Kategorie und Konfidenz kommen aus `choice`/`confidence`/`probabilities`, die Begründung wird daraus gebaut („Jev: 92 % interessiert, 5 % später …“). Der Antwort-Parser ist tolerant (das Format ist nicht verbindlich dokumentiert); ein unbekanntes Format ergibt eine verständliche Fehlermeldung, nie einen Absturz. Konfidenzschwelle 0,8 und Auto-Status-Regeln sind unverändert. Die Einstellung `ki_klassifizierer` (Einstellungen → KI-Funktionen, nur Modelle mit gesetztem Schlüssel) wählt `jev` oder `anthropic`; Standard ist Jev, wenn `OPENROUTER_API_KEY` gesetzt ist, sonst Claude. Die Einordnung läuft auch mit nur dem OpenRouter-Schlüssel; Schreibhilfe und Antwort-Entwurf sind unabhängig davon (siehe OpenAI unten); ohne OpenAI- und Anthropic-Schlüssel bleiben sie unsichtbar. Gespeichert wird das verwendete Modell (`ki_einordnung.modell`), die Oberfläche zeigt „eingeordnet mit Jev“.
  - **OpenAI für Texte/Entwürfe** (`lib/ki-openai.ts`): Antwort-Entwurf und Schreibhilfe können statt über Claude über OpenAI laufen (`POST {OPENAI_BASE_URL}/responses`, Responses API mit `instructions`/`input` und strukturierter JSON-Ausgabe; nur `fetch`, keine neue Abhängigkeit; die Responses API ist die aktuelle OpenAI-Schnittstelle, ein Chat-Completions-Fallback ist deshalb nicht eingebaut). Der Text wird tolerant aus `output_text` bzw. `output[].content[].text` gelesen. Einstellung `ki_entwurf_anbieter` (`openai` | `anthropic`, nur Anbieter mit gesetztem Schlüssel wählbar; Standard OpenAI, wenn `OPENAI_API_KEY` gesetzt ist). Die Modell-ID `gpt-5.5` (`OPENAI_MODEL`) ist nicht offiziell verifiziert: bei „model not found“ `OPENAI_MODEL` anpassen, siehe platform.openai.com/docs/models. Die Kombination Jev (Einordnung) + OpenAI (Entwürfe) funktioniert ohne Anthropic-Schlüssel vollständig.
  - **Schreibhilfe** (Modell Sonnet bzw. OpenAI; mit `OPENAI_API_KEY` oder `ANTHROPIC_API_KEY`): „KI-Vorschlag“ im Vorlagen-, Varianten- und Follow-up-Editor erzeugt aus einer Kurzbeschreibung Betreff + Text mit Platzhaltern (Video-Platzhalter nur bei Video-Kampagnen), optional mit Spintax. Das Ergebnis wird wie im Editor geprüft (Klammern, bekannte Platzhalter) und erst nach „Übernehmen“ ins Feld gesetzt.
  - **Antwort-Entwurf** (Modell Sonnet bzw. OpenAI): „Entwurf mit KI“ in der Unibox füllt das Antwortfeld anhand des Thread-Verlaufs und des Termin-Links der Kampagne; gesendet wird nie automatisch.
- Pipeline (CRM light) `/pipeline`: Kanban-Spalten je Lead-Status mit Leads, die geantwortet haben oder einen Status ≠ offen haben („Offen“ einklappbar), Karten mit Firma, Name, Kampagne, Deal-Wert und Tagen im Status, Anzahl und Summe je Spalte, Filter nach Kampagne. Verschieben per Drag-and-drop (native HTML5-DnD) oder Status-Dropdown auf der Karte (Mobil); der Statuswechsel läuft über dieselbe Logik wie überall (`setzeLeadStatus`, inkl. Flow-Stopp). `leads.deal_wert` (Cent) und `leads.deal_notiz` sind auf der Karte und im Lead-Detail bearbeitbar (Eingabe wie „1.234,50 €“, Anzeige de-DE). Logik rein in `lib/pipeline.ts`.
- Untersequenzen (Kampagnen-Einstellungen → „Untersequenzen“): Regel „Wenn Lead-Status = X → in Kampagne Y übernehmen“ (Tabelle `untersequenzen`, aktiv/inaktiv, löschbar). Ausgelöst zentral in `setzeLeadStatus` bei jedem geänderten Status (manuell, Pipeline, KI). Der Lead wird als neuer Datensatz kopiert (Stammdaten, `extra`, Zeitzone, Postfach `absender_id`, neuer Slug, `leads.herkunft_lead_id`); der Flow startet in der Ziel-Kampagne neu, dort schreibt dasselbe Postfach (der Versand bevorzugt das feste Postfach eines Leads statt der Rotation). Video-Ziel: zum Rendern vorgemerkt nur, wenn die Ziel-Kampagne bereits rendert/sendet, sonst wartet der Lead wie ein importierter. Nicht übernommen wird bei Sperrliste (Adresse/Domain), Abmeldung, gleicher E-Mail in der Ziel-Kampagne und Ziel = Quelle. Event `untersequenz` in der Zeitleiste des Ursprungs-Leads, Lead-Detail verlinkt Herkunft und Weiterleitung. „Kampagne duplizieren“ kopiert Regeln bewusst nicht (Ziel wäre unklar).
- Webhooks und REST-API (Einstellungen → Integrationen, Details und Beispiele in **[docs/api.md](docs/api.md)**): Ausgehende Webhooks (Tabellen `webhooks`, `webhook_zustellungen`) für Mail gesendet, Antwort, Bounce, Abwesenheit, Abmeldung, Lead-Status, Video angesehen/gestartet, Termin- und Link-Klick; `webhookAusloesen` (`lib/webhooks.ts`) legt nur Zustellungen in der DB an, der Worker (`worker/webhooks.ts`) stellt signiert zu (`X-Signatur: sha256=HMAC`, 10 s Zeitlimit, Wiederholung nach 1 min, 5 min, 30 min, 2 h, 12 h), Protokoll der letzten 100 Zustellungen, Aufräumen nach 30 Tagen; SSRF-Schutz (`WEBHOOK_PRIVATE_ERLAUBT=1` erlaubt private Ziele). REST-API unter `/api/v1` mit API-Schlüsseln (`vo_…`, nur als sha256-Hash gespeichert, Rechte lesen/schreiben, 120 Anfragen/min): Kampagnen und Leads lesen, Leads anlegen (gleiche Prüfung wie der Import), Lead-Status/Notizen/Deal-Wert setzen (über `setzeLeadStatus`, also mit Flow-Stopp und Untersequenzen).
- Team-Zugänge (Einstellungen → Benutzer, nur Admin): Tabellen `benutzer` und `einladungen`. Admin lädt per E-Mail-Adresse und Rolle ein; es wird nichts verschickt, der Einmal-Link `APP_URL/einladung/<token>` (7 Tage gültig, nur als sha256-Hash gespeichert, wird nur einmal angezeigt) wird kopiert und weitergegeben. Die eingeladene Person setzt Name und Passwort (mind. 12 Zeichen, scrypt `salz:hash`, N=2^15 r=8 p=1) und ist angemeldet. „Passwort zurücksetzen“ erzeugt ebenfalls einen Link. Rollen: **admin** = alles; **mitglied** = alles außer Postfächer verbinden/ändern/entfernen, globale Einstellungen, Integrationen (Webhooks/API-Schlüssel), Benutzerverwaltung und Kampagne löschen; **lesen** = nur ansehen und CSV exportieren. Durchgesetzt wird serverseitig in jeder API-Route über `erfordereRolle(req, rolle)` (`lib/session.ts`); ein Test listet alle Route-Dateien auf und schlägt fehl, wenn eine Methode weder den Helfer nutzt noch auf der Ausnahmeliste steht (`lib/rollen-abdeckung.test.ts`). Die UI blendet Aktionen nur als Komfort aus. Login: E-Mail leer = Admin-Zugang über `ADMIN_PASSWORD`, sonst Benutzer-Login (gleiche Ratelimits je IP, zusätzlich je E-Mail; gleiche Meldung und Rechenzeit bei unbekannter E-Mail). Das Session-Token hat das Format `ablauf.benutzerId.rolle.version.hmac`; Deaktivieren, Löschen, Rollenwechsel und Passwortwechsel erhöhen `benutzer.session_version` bzw. entfernen den Benutzer und beenden alle Sitzungen sofort (Prüfung in `aktuellerBenutzer()` mit DB, Middleware prüft nur Signatur/Ablauf und setzt `x-vo-rolle`/`x-vo-benutzer` nach dem Entfernen gleichnamiger Client-Header). **Hinweis zum Update:** Sitzungen im alten Token-Format (`ablauf.hmac`) sind ungültig, alle müssen sich einmal neu anmelden. Unter „Mein Konto“ ändern Benutzer Name und Passwort (altes Passwort nötig). Die REST-API `/api/v1` bleibt bei Bearer-Schlüsseln.
- Weitere Postfach-Anbieter per SMTP/IMAP (Einstellungen → Postfächer → „SMTP/IMAP-Postfach hinzufügen“, nur Admin; Anleitung und DNS-Hinweise in **[docs/smtp-einrichtung.md](docs/smtp-einrichtung.md)**): Neben Gmail (`absender.typ = 'gmail'`, Standard für den Bestand) gibt es Postfächer vom Typ `smtp` – Versand über nodemailer, Antwort-/Bounce-/Abwesenheits-Erkennung und Unibox über IMAP (imapflow). Voreinstellungen für Outlook/Microsoft 365, IONOS, Strato, web.de, GMX und „Sonstige“; „Verbindung testen“ meldet sich an beiden Servern an (es wird nichts gesendet); Bearbeiten mit leeren Passwortfeldern = unverändert; Typ-Badge „Gmail“/„SMTP/IMAP“. Die Passwörter stehen als ein AES-256-GCM-verschlüsseltes JSON `{smtpPasswort, imapPasswort}` in `absender.zugangsdaten_enc` und werden nie an den Client zurückgegeben. Alle Aufrufer gehen über die Treiber-Schnittstelle `lib/postfach-treiber.ts` (`senden`, `pruefeThread`, `ladeThread`, `kannLesen`): der Gmail-Treiber ist die bisherige Implementierung, der SMTP-Treiber (`lib/smtp-treiber.ts`) reicht die von `buildMime` gebaute Nachricht unverändert durch (Header, Message-ID, In-Reply-To), setzt den Umschlag (envelope) und legt optional eine Kopie im IMAP-Ordner „Gesendet“ (SPECIAL-USE `\Sent`) ab. „Thread“ ist bei SMTP die Message-ID der Erstmail (`gmail_thread_id = 'smtp:<Message-ID>'`); Antworten werden im Posteingang über `In-Reply-To`/`References` auf eine unserer Message-IDs oder über die Adresse des Leads (Datum nach der Erstmail) zugeordnet, Bounces nur, wenn der Zustellbericht (mailer-daemon/postmaster bzw. `multipart/report`) unsere Message-ID nennt, Abwesenheiten über `lib/autoreply.ts` – die Zuordnung ist eine reine Funktion (`lib/imap-zuordnung.ts`). Pro Prüfdurchlauf wird eine IMAP-Verbindung geöffnet (Zeitlimits, sauber geschlossen); Auth-Fehler pausieren das Postfach mit Meldung, Netzfehler werden später erneut versucht. Rotation, Limits, Aufwärmrampe, Bounce-Schutz, Abstand, Unibox (eigener MIME-Parser `lib/mime-roh.ts`), KI-Einordnung und Webhooks gelten für SMTP-Postfächer genauso; der Link „In Gmail öffnen“ erscheint nur bei Gmail-Postfächern.
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
| `ADMIN_PASSWORD` | ja | Passwort des Admin-Zugangs (Login ohne E-Mail, Rolle admin); bleibt auch mit Team-Zugängen bestehen und lässt sich nicht löschen |
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
| `SENDER_EMAIL`, `SENDER_NAME` | nein | Nur noch Vorschlag/Rückfall: `SENDER_EMAIL` ist der `login_hint` beim ersten Verbinden und die Adresse, falls ein altes Postfach ohne gespeicherte Adresse übernommen wird; `SENDER_NAME` ist der Standard-Absendername. Die Postfächer selbst verwaltet man unter Einstellungen. |
| `DEFAULT_CTA_URL` | nein | Standard-Termin-Link neuer Kampagnen |
| `IMPRESSUM_URL`, `DATENSCHUTZ_URL` | empfohlen | Links im Footer der Video-Seite |
| `SEND_MIN_GAP_MINUTES`, `SEND_MAX_GAP_MINUTES` | nein | Zufälliger Abstand zwischen zwei Mails (Standard 3 bis 9) |
| `WEBHOOK_PRIVATE_ERLAUBT` | nein | `1` erlaubt Webhook-Ziele im lokalen/privaten Netz (Tests, Intranet); Standard aus (SSRF-Schutz). Muss im Worker gesetzt sein, der die Webhooks zustellt |
| `ANTHROPIC_API_KEY` | nein | Schaltet die optionalen KI-Funktionen frei (siehe „Funktionen“ und „Datenschutz-Hinweise“). Leer = alles aus und unsichtbar |
| `OPENROUTER_API_KEY` | nein | Schlüssel für Jev (TypeSafe AI) über OpenRouter als Klassifizierer der Einordnung. Reicht allein für die Einordnung; Schreibhilfe/Entwurf brauchen weiterhin `ANTHROPIC_API_KEY`. Datenschutz: Mailtexte gehen an OpenRouter/TypeSafe (USA) |
| `OPENAI_API_KEY` | nein | Schlüssel für OpenAI als Anbieter der Antwort-Entwürfe und der Schreibhilfe (statt Anthropic). Datenschutz: Mailtexte gehen an OpenAI (USA) |
| `OPENAI_MODEL`, `OPENAI_BASE_URL` | nein | OpenAI-Modell (Standard `gpt-5.5`, nicht offiziell verifiziert: bei „model not found“ anpassen, siehe platform.openai.com/docs/models) und Basis-URL (Standard `https://api.openai.com/v1`, für Tests/Proxy überschreibbar) |
| `JEV_MODELL`, `JEV_BASE_URL` | nein | Jev-Modell (Standard `typesafe/jev-1.13`, Alias `~typesafe/jev-latest`) und Basis-URL (Standard `https://openrouter.ai/api`, für Tests/Proxy überschreibbar) |
| `ANTHROPIC_MODEL_SCHREIBEN`, `ANTHROPIC_MODEL_KLASSIFIZIEREN` | nein | Modelle für Schreibhilfe/Antwort-Entwurf (Standard `claude-sonnet-5-5`) und Klassifikation (Standard `claude-haiku-5-5`) |

## Gmail-Einrichtung

Ausführliche Schritt-für-Schritt-Anleitung: **[docs/gmail-einrichtung.md](docs/gmail-einrichtung.md)**. Kein Gmail (Outlook/Microsoft 365, IONOS, Strato, web.de, GMX …)? Dann SMTP/IMAP-Postfächer nutzen: **[docs/smtp-einrichtung.md](docs/smtp-einrichtung.md)** (inkl. SPF/DKIM/DMARC-Hinweisen).

Kurzfassung: In der Google Cloud Console ein Projekt anlegen, die Gmail API aktivieren, den OAuth-Zustimmungsbildschirm als „Intern“ (Workspace) mit den Bereichen `gmail.send`, `gmail.metadata` sowie `openid` und `email` (optional für die Unibox `gmail.readonly`) einrichten, einen OAuth-Client „Webanwendung“ erstellen und als Weiterleitungs-URIs `http://localhost:3000/api/gmail/callback` sowie `https://video.DEINEDOMAIN.de/api/gmail/callback` eintragen. Client-ID, Secret und Redirect-URI in die `.env`, Dienste neu starten, im Dashboard unter Einstellungen → Postfächer „Gmail-Postfach hinzufügen“ und mit einer Testmail prüfen.

**Mehrere Postfächer:** Jedes Konto wird einzeln verbunden („Gmail-Postfach hinzufügen“). Die Adresse liest die App aus dem ID-Token von Google (Bereiche `openid` und `email`); dieselbe Adresse erneut zu verbinden aktualisiert nur den Token („Neu verbinden“). Je Postfach: Name, Tageslimit, eigene Signatur (leer = Standard-Signatur), Pausieren, Entfernen.

**Update von einer Version mit einem Postfach:** Ein „Neu verbinden“ ist **nicht** nötig. Beim ersten Start nach dem Update wird das bisherige Postfach (`gmail_*`-Einstellungen) automatisch als erstes Postfach übernommen (Tageslimit = bisheriges globales Limit, Name = bisheriger Absendername); bereits gesendete Leads und Mails werden ihm zugeordnet, damit laufende Follow-ups und die Antwort-Erkennung weiterlaufen. Nur **neue** Postfächer brauchen die zusätzlichen Bereiche `openid` und `email` – diese im OAuth-Zustimmungsbildschirm ergänzen, bevor das zweite Postfach verbunden wird.

## Versandregeln

- Es werden nur fertig gerenderte, nicht gesperrte und nicht abgemeldete Leads versendet.
- Versandfenster: Standard Montag bis Freitag, 08 bis 17 Uhr (Zeitzone der Kampagne, Standard Europe/Berlin; für Leads mit eigener Zeitzone deren Ortszeit – `leads.zeitzone`, leer = Kampagne). Die Versandtage wählt man je Kampagne frei (Mo–So, `campaigns.send_days`, z. B. `1,2,3,4,5`; 1 = Montag). Die alte Spalte `send_weekdays_only` bleibt bestehen, wird aber nicht mehr ausgewertet (die Migration hat `send_days` daraus übernommen).
- Startdatum (optional, je Kampagne): vorher wird nicht gesendet.
- Gesamtlimit: Standard 30 Mails pro Tag über alle Kampagnen **und alle Postfächer** hinweg (inkl. Follow-ups, Einstellung „Gesamtlimit über alle Postfächer“). Zusätzlich hat jedes Postfach sein eigenes Tageslimit (Standard 30).
- Rotation (`lib/rotation.ts`): Eine Erstmail geht über das aktive, verbundene Postfach ohne Auth-Fehler und ohne Quota-Stopp, dessen Abstand abgelaufen ist und dessen heutige Mails unter dem effektiven Limit liegen (min aus Tageslimit und Rampe); unter mehreren gewinnt das mit den wenigsten Mails heute, bei Gleichstand die kleinere ID. Follow-ups und Antwort-Erkennung laufen immer über das Postfach der Erstmail (`leads.absender_id`); ist es pausiert, getrennt, fehlerhaft oder für heute gestoppt, **wartet** das Follow-up (nie über ein fremdes Postfach, der Thread gehört nur dorthin). Altbestand ohne Zuordnung läuft über das älteste aktive Postfach.
- Neue Leads pro Tag (optional, je Kampagne): begrenzt nur Erstmails. Ist das Limit erreicht, gehen heute nur noch fällige Follow-ups raus (sie haben ohnehin Vorrang und unterliegen nur dem Tageslimit).
- Aufwärmrampe (Einstellungen, Standard aus): effektives Limit = min(Limit, Startwert + Schritt x Tage seit Beginn); Standard 10 Mails am ersten Tag, plus 5 pro Tag. Sie gilt für das Gesamtlimit (Beginn: eingetragenes Datum, sonst Tag der ersten gesendeten Mail, sonst heute) und **je Postfach** für dessen Tageslimit (Beginn: Rampen-Beginn des Postfachs, sonst Tag seiner ersten Mail, sonst heute) – ein neu hinzugefügtes Postfach startet also wieder bei 10. Die Einstellungen zeigen „Heute insgesamt erlaubt: N“, die Postfach-Liste „Heute x / Limit“. Logik als reine Funktion in `lib/rampe.ts`.
- Domain-Sperrliste: Ein Eintrag mit `@` davor (z. B. `@firma.de`) sperrt die ganze Domain (nicht Subdomains) für Import, Versand und Follow-ups; ausstehende Mails an die Domain werden übersprungen.
- MX-Prüfung beim Import: Domains werden per DNS auf Mail-Server geprüft (MX, sonst A/AAAA als Fallback nach RFC 5321; Zeitlimit 3 s, Cache je Domain, höchstens 10 Abfragen gleichzeitig). Domains ohne beides werden als „Domain nimmt keine Mails an“ gewarnt und standardmäßig nicht importiert (Option „trotzdem importieren“). Timeout oder Netzfehler zählt als „unbekannt“ und blockiert nicht.
- Zufälliger Abstand zwischen zwei Mails **desselben Postfachs**: 3 bis 9 Minuten (`SEND_MIN_GAP_MINUTES`/`SEND_MAX_GAP_MINUTES`, gespeichert in `absender.next_send_at`). Mehrere Postfächer senden dadurch zeitversetzt parallel; die Schleife verschickt dabei höchstens eine Mail pro Durchlauf (alle 3 s).
- Pausieren und Fortsetzen jederzeit; Fehler werden pro Lead gespeichert. Meldet Gmail (bzw. der SMTP-Server, z. B. `5.4.5 Daily user sending quota exceeded`) ein Limit (Quota), stoppt nur das betroffene Postfach für den Tag (die anderen senden weiter). Ein Auth-Fehler (Gmail `invalid_grant`, bei SMTP/IMAP „Anmeldung fehlgeschlagen“) markiert das Postfach mit dem Fehler und pausiert es, bis es neu verbunden bzw. seine Zugangsdaten geprüft sind; Netzwerkfehler sind vorübergehend und pausieren nichts.
- Mails: `multipart/alternative`, schlichtes HTML, kein Anhang, Signatur mit Impressumsangaben, Abmeldelink sowie `List-Unsubscribe` und `List-Unsubscribe-Post`.
- Neue Absenderdomänen langsam hochfahren (10, dann 20, dann 30 pro Tag); SPF, DKIM und DMARC müssen eingerichtet sein.

## Tracking, Bot-Erkennung und Score

- Die Video-Seite sendet Ereignisse per `POST /api/t` (`sendBeacon`): `page_view` (nur per JavaScript), `play`, Fortschritt 25/50/75/100 %, `cta_click`. Das Öffnungs-Pixel ist optional (standardmäßig aus) und gilt als unzuverlässig.
- Bot-Erkennung: Anfragen mit typischen User-Agents von Link-Scannern und Vorschau-Diensten (Safe Links, Proofpoint, Mimecast, Crawler, Preview-Bots) werden als Bot markiert, im Dashboard grau dargestellt und nicht gewertet.
- Score (nur Nicht-Bot-Ereignisse): `play` 10 (einmalig), 50 % gesehen 10, 100 % gesehen 15, Termin-Klick 30 (einmalig), plus 5 je weiterem Besuchstag. Das Dashboard sortiert standardmäßig nach Score absteigend.
- Klick-Tracking (`/api/c/<token>`, optional je Kampagne): Das Token ist HMAC-signiert (Schlüssel `ENCRYPTION_KEY`, Lead + Ziel-URL im Token, keine Tabelle). Die Route leitet nur auf URLs weiter, die für diesen Lead erzeugt wurden (kein Open-Redirect), unbekannte oder manipulierte Token ergeben eine 404-Seite. Bots werden als Bot protokolliert und trotzdem weitergeleitet. Vorschau und Testmail hängen `?vorschau=1` an, damit Klicks darin keine Events echter Leads erzeugen. `ENCRYPTION_KEY` nicht ändern, sonst werden bereits versendete Links ungültig.
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

Das Skript klont nach `/srv/videooutreach` (`INSTALL_DIR`), erzeugt `.env` (Zufallswerte, fragt Google Client-ID/-Secret ab) und `docker-compose.override.yml`, startet alles, wartet auf die Health der App und richtet den Backup-Cron (täglich 03:15) ein. Erkennung übersteuern: `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERTRESOLVER`. Trockenlauf: `DRY_RUN=1`. **Update** = Skript erneut ausführen (git pull + Rebuild, `.env` und `data/` bleiben). Danach Redirect-URI in der Google Cloud Console eintragen und unter `/einstellungen` ein Postfach hinzufügen.

### 7. HTTPS prüfen

`https://video.DEINEDOMAIN.de/login` im Browser öffnen (Schloss-Symbol, Login-Seite). `curl -I https://video.DEINEDOMAIN.de/media/x.mp4` ohne Datei liefert 404, mit Datei Header `Accept-Ranges` und `Cache-Control`.

### 8. Gmail Redirect URI

In der Google Cloud Console beim OAuth-Client `https://video.DEINEDOMAIN.de/api/gmail/callback` als Weiterleitungs-URI eintragen (siehe [docs/gmail-einrichtung.md](docs/gmail-einrichtung.md)). Im Dashboard unter Einstellungen → Postfächer „Gmail-Postfach hinzufügen“ und Testmail senden.

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
| `invalid_grant` beim Senden | Das betroffene Postfach ist in den Einstellungen als „Fehler“ markiert und pausiert: dort „Neu verbinden“ (gleiche Adresse aktualisiert den Token) |
| Neues Postfach: „kein ID-Token“ / keine E-Mail-Adresse | Bereiche `openid` und `email` im OAuth-Zustimmungsbildschirm ergänzen, dann erneut „Gmail-Postfach hinzufügen“ |
| SMTP/IMAP-Postfach: „Anmeldung fehlgeschlagen“ | Benutzername/Passwort prüfen (Microsoft 365: App-Passwort bzw. SMTP AUTH im Tenant aktivieren, siehe [docs/smtp-einrichtung.md](docs/smtp-einrichtung.md)); in Einstellungen → Postfächer → Bearbeiten → „Verbindung testen“, danach löscht ein Speichern den Fehler |
| SMTP/IMAP: „Keine Verbindung zum … Server“ | Host, Port und Verschlüsselung prüfen (465 = SSL, 587 = STARTTLS, IMAP 993 = SSL); Firewall des Servers (ausgehende Ports 465/587/993) |
| Unibox: „Lesezugriff fehlt“ | Bereich `gmail.readonly` im Zustimmungsbildschirm ergänzen, dann in Einstellungen → Postfächer „Lesezugriff erteilen“ |
| Zertifikat wird nicht ausgestellt | DNS-A-Record noch nicht aktiv oder Port 80 gesperrt (`ufw`, Hetzner-Firewall) |
| Port 80/443 belegt beim Start von Caddy-Container | Es läuft schon ein Webserver; Variante A, B (Host) oder C wählen |
| Healthcheck „unhealthy“ | `docker compose logs app`; meist fehlende `.env`-Werte |

## Datenschutz-Hinweise

- Gespeichert werden Firmen-/Kontaktdaten der Leads, Versand- und Tracking-Ereignisse. Rechtsgrundlage und Zulässigkeit der Kaltakquise (insbesondere E-Mail-Werbung nach § 7 UWG) vor Einsatz rechtlich prüfen lassen; das ersetzt keine Rechtsberatung.
- Die Video-Seite setzt keine Cookies und lädt keine Drittanbieter-Skripte. IP-Adressen werden nur gesalzen gehasht gespeichert (`IP_HASH_SALT` geheim halten und nicht ändern, sonst passen alte Hashes nicht mehr).
- Impressum und Datenschutzerklärung müssen verlinkt sein (`IMPRESSUM_URL`, `DATENSCHUTZ_URL`) und das Tracking sowie den Abmeldeweg benennen. Mit dem Hosting-Anbieter (Hetzner) sollte ein Auftragsverarbeitungsvertrag bestehen, ebenso für Google Workspace.
- Abmeldungen landen in einer kampagnenübergreifenden Sperrliste und werden nie wieder angeschrieben. Löschwünsche: Lead im Dashboard löschen und zugehörige Dateien in `data/media/` entfernen.
- Mit Lesezugriff (Unibox) liest die App Threads der Leads direkt von Gmail; Inhalte werden nicht gespeichert (nur 60 s im Arbeitsspeicher) und nur als Text angezeigt.
- KI-Funktionen (nur mit `ANTHROPIC_API_KEY`): Dafür werden Mailtexte (Antworten der Leads, Thread-Verlauf, Beschreibungen für die Schreibhilfe, Terminlink) an Anthropic übertragen. Vor der Nutzung einen Auftragsverarbeitungsvertrag (AVV/DPA) mit Anthropic abschließen, die Datenschutzerklärung entsprechend ergänzen und prüfen, ob die Übermittlung an einen US-Anbieter zulässig ist. Ergebnisse der Einordnung stehen in der Datenbank (`leads.ki_einordnung`), Mailtexte selbst werden weder gespeichert noch geloggt. Wer das nicht möchte, lässt den Schlüssel leer – dann ist alles aus. Beim Anbieter OpenAI (Entwürfe/Schreibhilfe) gehen Thread-Verlauf und Beschreibungen an OpenAI (USA); auch hier AVV/DPA abschließen. Wird als Klassifizierer Jev gewählt (`OPENROUTER_API_KEY`), gehen die Texte der Antworten stattdessen an OpenRouter/TypeSafe (USA); auch dafür vorher den AVV bzw. die Datenschutzbedingungen von OpenRouter und TypeSafe prüfen und die Datenschutzerklärung ergänzen.
- OAuth-Tokens sind AES-256-GCM-verschlüsselt in der Datenbank. `.env`, `data/` und `backups/` enthalten Geheimnisse bzw. personenbezogene Daten: Rechte restriktiv halten, nicht ins Repository, Backups verschlüsselt extern ablegen.
- Sicherheit: Port 3000 nur auf `127.0.0.1`, sicheres Admin-Passwort, regelmäßige Updates (`apt upgrade`, `git pull && docker compose up -d --build`).
