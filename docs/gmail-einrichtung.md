# Gmail einrichten (Google Workspace)

Das Dashboard versendet über die Gmail-API mit dem Konto `Amin.douioui@prozessia.de` (Google Workspace).
Es wird ausschließlich die Berechtigung **„E-Mails senden“** (`gmail.send`) angefordert – kein Lesen des Postfachs.

Einmalig durchführen (ca. 10 Minuten). Du brauchst Zugriff auf die Google Cloud Console mit einem Workspace-Konto
der Domain prozessia.de (idealerweise Admin).

## 1. Projekt anlegen

1. <https://console.cloud.google.com> öffnen, oben beim Projekt-Auswahlfeld **Neues Projekt** wählen.
2. Name z. B. `video-outreach`, Organisation `prozessia.de`, **Erstellen**. Das neue Projekt auswählen.

## 2. Gmail API aktivieren

1. **APIs & Dienste → Bibliothek**.
2. Nach „Gmail API“ suchen, öffnen, **Aktivieren**.

## 3. OAuth-Zustimmungsbildschirm

1. **APIs & Dienste → OAuth-Zustimmungsbildschirm** (bzw. „Google Auth Platform → Branding/Zielgruppe“).
2. Nutzertyp **Intern** wählen (nur Konten der eigenen Workspace-Organisation; keine Google-Prüfung nötig,
   Refresh-Tokens laufen nicht nach 7 Tagen ab).
3. App-Name `Video-Outreach`, Support-E-Mail und Entwickler-Kontakt: `Amin.douioui@prozessia.de`. Speichern.
4. **Datenzugriff / Bereiche → Bereiche hinzufügen**: `https://www.googleapis.com/auth/gmail.send` eintragen
   (steht unter „Gmail API“ als „E-Mails senden“), speichern.

> Erscheint „Intern“ nicht auswählbar, gehört das Projekt nicht zur Workspace-Organisation. Dann das Projekt
> unter der Organisation prozessia.de neu anlegen (Schritt 1).

## 4. OAuth-Client (Webanwendung)

1. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**.
2. Anwendungstyp **Webanwendung**, Name `Video-Outreach Web`.
3. **Autorisierte Weiterleitungs-URIs** (beide eintragen, exakt, ohne Slash am Ende):
   - `http://localhost:3000/api/gmail/callback` (lokale Entwicklung)
   - `https://video.DOMAIN/api/gmail/callback` (Produktion, `DOMAIN` durch die echte Subdomain ersetzen)
4. **Erstellen**. Client-ID und Client-Secret kopieren.

## 5. In `.env` eintragen

```
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-…
GOOGLE_REDIRECT_URI=https://video.DOMAIN/api/gmail/callback   # lokal: http://localhost:3000/api/gmail/callback
SENDER_EMAIL=Amin.douioui@prozessia.de
SENDER_NAME=Amin Douioui
```

`GOOGLE_REDIRECT_URI` muss **exakt** einer der in Schritt 4 eingetragenen URIs entsprechen, und `APP_URL`
muss die öffentliche Adresse sein (`https://video.DOMAIN`). Danach App (und Worker) neu starten.

## 6. Verbinden

1. Im Dashboard einloggen, **Einstellungen** öffnen.
2. **Gmail verbinden** klicken, mit `Amin.douioui@prozessia.de` anmelden und die Berechtigung bestätigen.
3. Du landest wieder auf der Einstellungsseite mit „Verbunden“. Der Refresh-Token wird AES-256-GCM-verschlüsselt
   in der Datenbank gespeichert.
4. In der Kampagne unter **Vorlage** mit „Testmail an mich senden“ prüfen, dass die Mail ankommt.

## Hinweise und Fehlersuche

- **`redirect_uri_mismatch`**: URI in der Cloud Console und `GOOGLE_REDIRECT_URI` stimmen nicht exakt überein.
- **Kein Refresh-Token**: Zugriff unter <https://myaccount.google.com/permissions> entfernen und neu verbinden.
- **`invalid_grant` beim Senden**: Verbindung trennen und neu verbinden (z. B. nach Passwortänderung).
- **Limits**: Workspace erlaubt ca. 2000 Mails/Tag über die API; die App sendet bewusst nur 30/Tag mit
  3–9 Minuten Abstand. Meldet Gmail ein Limit (429/`rateLimitExceeded`), stoppt der Versand für den Tag.
- **Zustellbarkeit**: SPF, DKIM und DMARC für prozessia.de müssen im DNS eingerichtet sein (Admin-Konsole →
  E-Mail authentifizieren). Neue Kampagnen langsam hochfahren (z. B. 10, dann 20, dann 30 pro Tag).
- Ein Wechsel des Absenderkontos: Verbindung trennen, `SENDER_EMAIL` anpassen, neu verbinden.
