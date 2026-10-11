# REST-API und Webhooks

Die API liest Kampagnen und Leads, legt Leads an und setzt den Lead-Status. Webhooks melden Ereignisse (Antwort, Statuswechsel, Video angesehen …) an andere Systeme. Beides richtet man im Dashboard unter **Einstellungen → Integrationen** ein.

## Authentifizierung

1. Unter **Einstellungen → Integrationen → API-Schlüssel** einen Schlüssel mit Namen und Rechten anlegen. Der Schlüssel (`vo_…`) wird **nur einmal** angezeigt; gespeichert wird nur ein Hash. Verloren = neuen Schlüssel anlegen, alten widerrufen.
2. Jede Anfrage trägt den Schlüssel als Bearer-Token:

```bash
curl -H "Authorization: Bearer vo_XXXXXXXX" https://video.DEINEDOMAIN.de/api/v1/kampagnen
```

| Recht | erlaubt |
| --- | --- |
| `lesen` | alle `GET`-Endpunkte |
| `schreiben` | zusätzlich Leads anlegen (`POST`) und ändern (`PATCH`); schließt `lesen` ein |

Fehler kommen immer als JSON `{"fehler": "…"}`:

| Status | Bedeutung |
| --- | --- |
| 400 | Ungültige Eingabe |
| 401 | Schlüssel fehlt, unbekannt oder widerrufen |
| 403 | Recht reicht nicht (Schlüssel hat nur `lesen`) |
| 404 | Kampagne/Lead nicht gefunden |
| 429 | Zu viele Anfragen: höchstens 120 pro Minute und Schlüssel (`Retry-After: 60`) |

Die Antworten enthalten keine Tokens oder Zugangsdaten.

## Endpunkte

### `GET /api/v1/kampagnen`

```bash
curl -H "Authorization: Bearer $KEY" https://video.DEINEDOMAIN.de/api/v1/kampagnen
```

```json
{ "kampagnen": [ { "id": 3, "name": "Einkauf Bau", "status": "bereit", "mitVideo": true, "zeitzone": "Europe/Berlin", "tageslimit": 30, "leadAnzahl": 120, "erstelltAm": "2026-07-01T08:00:00.000Z" } ] }
```

### `GET /api/v1/kampagnen/{id}`

Eine Kampagne (`{"kampagne": {…, "followups": 2}}`).

### `GET /api/v1/kampagnen/{id}/leads?seite=1&status=interessiert`

Leads der Kampagne, 50 pro Seite (älteste zuerst). `status` (optional) filtert nach Lead-Status: `offen`, `interessiert`, `termin_gebucht`, `spaeter`, `nicht_interessiert`, `falscher_ansprechpartner`, `gewonnen`, `verloren`.

```bash
curl -H "Authorization: Bearer $KEY" "https://video.DEINEDOMAIN.de/api/v1/kampagnen/3/leads?seite=2&status=interessiert"
```

```json
{ "seite": 2, "seitenGroesse": 50, "gesamt": 61, "seiten": 2, "leads": [ { "id": 41, "kampagneId": 3, "firma": "Musterbau GmbH", "vorname": "Eva", "nachname": "Muster", "email": "eva@musterbau.de", "leadStatus": "interessiert", "score": 45, "sendStatus": "gesendet", "flowStopp": "beantwortet", "abgemeldet": false, "notizen": null, "dealWert": 12000, "videoLink": "https://video.DEINEDOMAIN.de/v/musterbau-k7f3", "…": "…" } ] }
```

`dealWert` ist in Euro (`null` = keiner).

### `POST /api/v1/kampagnen/{id}/leads` (Recht `schreiben`)

Ein Lead (`firma` und `email` Pflicht) oder mehrere unter `leads` (höchstens 500). Bekannte Felder: `firma`, `email`, `name` (voller Name) oder `vorname`/`nachname`, `anrede`, `position`, `website`, `land`, `zeitzone`. Alle weiteren Felder werden zu Extra-Spalten (Variablen in Vorlagen, z. B. `{{stadt}}`). Optional `einProFirma` (nur ein Kontakt je Firma) und `mxTrotzdem` (Domains ohne Mail-Server trotzdem anlegen).

Es gilt dieselbe Prüfung wie beim Import: ungültige E-Mail, fehlende Pflichtfelder, Duplikate (in der Anfrage und in der Kampagne), Sperrliste (Adressen und Domains), MX-Prüfung; die Zeitzone wird erkannt wie beim Import. Ungültige Zeilen werden übersprungen, die übrigen angelegt.

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"leads":[{"firma":"Musterbau GmbH","email":"eva@musterbau.de","vorname":"Eva","nachname":"Muster","stadt":"Köln"},{"firma":"Kaputt","email":"keine-mail"}]}' \
  https://video.DEINEDOMAIN.de/api/v1/kampagnen/3/leads
```

```json
{
  "angelegt": 1, "uebersprungen": 1, "zusammenfassung": "1 gültig, 1 ungültige E-Mail",
  "ergebnisse": [
    { "index": 0, "email": "eva@musterbau.de", "ergebnis": "angelegt", "id": 77 },
    { "index": 1, "email": "keine-mail", "ergebnis": "uebersprungen", "grund": "Ungültige E-Mail", "code": "ungueltige_email" }
  ]
}
```

Status 201, wenn mindestens ein Lead angelegt wurde, sonst 200. Gründe (`code`): `ungueltige_email`, `fehlende_pflichtfelder`, `duplikat_datei`, `duplikat_bestand`, `duplikat_firma`, `gesperrt`, `kein_mx`.

### `GET /api/v1/leads/{id}`

Ein Lead (`{"lead": {…}}`).

### `PATCH /api/v1/leads/{id}` (Recht `schreiben`)

Mit `leadStatus`, `notizen` und/oder `dealWert` (Euro als Zahl oder Text wie `"1.234,50 €"`; `null` löscht). Der Lead-Status läuft über dieselbe Logik wie im Dashboard: Flow-Stopp, Untersequenzen und Webhook `lead_status` greifen.

```bash
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"leadStatus":"interessiert","dealWert":12000,"notizen":"Rückruf am Montag"}' \
  https://video.DEINEDOMAIN.de/api/v1/leads/77
```

## Webhooks

Unter **Einstellungen → Integrationen → Webhooks** URL und Ereignisse wählen. „Test senden“ legt eine Zustellung mit Ereignis `test` an. Das Geheimnis dient der Signaturprüfung (anzeigen, neu erzeugen).

Ereignisse:

| Ereignis | Wann |
| --- | --- |
| `mail_gesendet` | Erstmail oder Follow-up wurde gesendet (`daten.schritt`: 0 = Erstmail, 1 … = Follow-up, `daten.variante`) |
| `antwort` | Eine Antwort wurde erkannt |
| `bounce` | Die Mail kam als nicht zustellbar zurück |
| `abwesenheit` | Abwesenheitsnotiz erkannt (`daten.bis`: Follow-ups warten bis dahin, sonst `null`) |
| `abmeldung` | Der Lead hat sich abgemeldet |
| `lead_status` | Lead-Status geändert (`daten.alt`, `daten.neu`) |
| `video_angesehen` | Erster Aufruf der Video-Seite je Lead (kein Bot) |
| `video_gestartet` | Erster Videostart je Lead (kein Bot) |
| `termin_klick` | Klick auf den Termin-Button (kein Bot) |
| `link_klick` | Klick auf einen getrackten Link in der Mail (kein Bot; `daten.url`) |

Ereignisse von Bots (Link-Scanner, Mail-Prefetch) lösen nie einen Webhook aus.

### Payload

`POST` mit `Content-Type: application/json`:

```json
{
  "ereignis": "lead_status",
  "zeit": "2026-07-15T09:00:00.000Z",
  "daten": {
    "lead": { "id": 77, "email": "eva@musterbau.de", "firma": "Musterbau GmbH", "vorname": "Eva", "nachname": "Muster", "kampagne": { "id": 3, "name": "Einkauf Bau" }, "leadStatus": "interessiert", "score": 45 },
    "alt": "offen",
    "neu": "interessiert"
  }
}
```

Header: `X-Signatur: sha256=<Hex>`, `X-Ereignis: lead_status`, `X-Zustellung-Id: 123`.

### Signatur prüfen

`X-Signatur` ist der HMAC-SHA256 des **rohen Request-Bodys** mit dem Geheimnis des Webhooks. Beispiel (Node, Express):

```js
const crypto = require('crypto');
const express = require('express');
const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const erwartet = 'sha256=' + crypto.createHmac('sha256', process.env.WEBHOOK_GEHEIMNIS).update(req.body).digest('hex');
  const erhalten = req.get('X-Signatur') || '';
  const gleich = erwartet.length === erhalten.length && crypto.timingSafeEqual(Buffer.from(erwartet), Buffer.from(erhalten));
  if (!gleich) return res.status(401).end();
  const nachricht = JSON.parse(req.body.toString('utf8'));
  console.log(nachricht.ereignis, nachricht.daten.lead.email);
  res.status(204).end();
});
app.listen(3000);
```

### Zustellung und Wiederholungen

- Der Worker stellt Zustellungen innerhalb weniger Sekunden zu. Jede Antwort mit Status 2xx gilt als erfolgreich; Zeitlimit 10 s; Weiterleitungen (3xx) werden nicht verfolgt und zählen als Fehler.
- Bei Fehlern (anderer Status, Timeout, Verbindungsfehler) wird mit wachsendem Abstand wiederholt: nach 1 min, 5 min, 30 min, 2 h und 12 h. Danach steht die Zustellung auf „Fehler“. Insgesamt also höchstens 6 Versuche.
- Der Empfänger sollte idempotent sein: `X-Zustellung-Id` bleibt bei Wiederholungen gleich; „Erneut senden“ im Protokoll erzeugt eine neue Zustellung mit neuer ID.
- Das Protokoll zeigt je Webhook die letzten 100 Zustellungen mit Status, HTTP-Code und Fehler; Einträge älter als 30 Tage werden gelöscht.
- Die Reihenfolge der Zustellung ist nicht garantiert (bei Wiederholungen können Ereignisse später ankommen); `zeit` nennt den Zeitpunkt des Ereignisses.

### Sicherheit (SSRF-Schutz)

Erlaubt sind nur `http://` und `https://` ohne Zugangsdaten in der URL. Ziele auf `localhost`, private, link-local und andere interne Adressen werden abgelehnt, auch wenn ein Hostname erst per DNS darauf zeigt; die Prüfung läuft beim Anlegen und bei jedem Versuch. Weiterleitungen werden nicht verfolgt. Für Tests oder Ziele im Intranet setzt man `WEBHOOK_PRIVATE_ERLAUBT=1` (in der Umgebung von **App und Worker**).
