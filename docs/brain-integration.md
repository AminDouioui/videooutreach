# Brain-Anbindung (Lead-Kontext)

Das Brain (Second Brain von Prozessia) liefert zu einem Lead Notizen, Felder und die letzten Kundendokumente. Videooutreach nutzt das ausschließlich lesend:

- aufklappbarer Bereich „Aus dem Brain“ im Lead-Detail und in der Unibox,
- „Entwurf mit KI“ in der Unibox bekommt den Kontext als internes Hintergrundwissen.

Ohne Brain-Verbindung (oder bei einem Fehler) läuft alles wie bisher; der Entwurf trägt dann den Hinweis „ohne Brain-Kontext“.

## Einrichtung

1. Im Brain in `backend/.env` den Wert `EXTERN_API_TOKEN` setzen (mindestens 32 Zeichen, zufällig, z. B. `openssl rand -hex 32`) und das Brain neu starten. Ohne diesen Wert sind die Endpunkte dort aus (503).
2. In Videooutreach unter **Einstellungen → Integrationen → Brain** (nur Admin) die Brain-URL (z. B. `https://brain.prozessia.space`) und denselben Token eintragen, speichern und „Verbindung testen“ klicken.
   Alternativ per Umgebung: `BRAIN_URL` und `BRAIN_API_TOKEN` in der `.env`. Ein in der App gespeicherter Wert hat Vorrang; „Entfernen“ löscht nur die App-Werte.
3. Der Token wird AES-256-GCM verschlüsselt in der Datenbank abgelegt und nie an den Browser zurückgegeben (nur die Maske „…abcd“). Er taucht in keiner Antwort, keinem Log und keinem HTML auf.

## Schnittstelle (Brain, nur lesend)

```
GET {BRAIN_URL}/api/extern/health
GET {BRAIN_URL}/api/extern/lead-kontext?email=<adresse>&firma=<name>&domain=<domain>
Authorization: Bearer <Token>
```

- `health`: `200 {"ok": true}`, `401` bei falschem Token, `503` wenn `EXTERN_API_TOKEN` im Brain fehlt.
- `lead-kontext`: `200 {gefunden, lead, kunde, stand}`. `lead` enthält Dateipfad, Firma, Status, Score, einfache Felder und Notizen (höchstens 3000 Zeichen), `kunde` den Ordner und bis zu 5 Dokumente (neueste zuerst, Auszug höchstens 800 Zeichen). Zuordnung nur über exakte E-Mail, exakte Domain oder normalisierten Firmennamen; Freemail-Domains zählen nie als Domain-Treffer. `400` ohne Parameter, `401`, `429` (60 pro Minute).
- Videooutreach sendet `email` (klein geschrieben), `domain` (aus der Website des Leads, sonst aus der E-Mail-Adresse; nie eine Freemail-Domain) und `firma`.

## Verhalten in Videooutreach

- Zeitlimit 5 Sekunden, keine Weiterleitungen (der Token geht an keine andere Adresse).
- Ergebnis je Lead 10 Minuten im Speicher des Servers; „Neu laden“ in „Aus dem Brain“ umgeht den Cache.
- Antworten werden tolerant gelesen (unbekannte Felder werden ignoriert, zu lange Texte gekürzt); eine Antwort ohne boolesches `gefunden` gilt als Fehler.
- Route `GET /api/leads/[id]/brain-kontext[?frisch=1]` ab Rolle „lesen“. Alle Texte werden als reiner Text angezeigt (kein HTML).
- Im Prompt steht der Kontext gekürzt (rund 4000 Zeichen) zwischen `<hintergrundwissen>`-Tags, mit der Anweisung: nicht zitieren, keine internen Details preisgeben, nichts behaupten, was nicht belegt ist.

## Datenschutz

Beim „Entwurf mit KI“ geht der gekürzte Brain-Kontext zusammen mit dem Mailverlauf an den gewählten KI-Anbieter (OpenAI oder Anthropic, jeweils USA). Vorher einen Auftragsverarbeitungsvertrag prüfen und die Datenschutzerklärung anpassen. Das Brain selbst wird nur gelesen; es gehen keine Daten dorthin.
