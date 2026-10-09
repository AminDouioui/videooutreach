# Gmail einrichten (Google Workspace)

Das Dashboard versendet über die Gmail-API mit einem oder mehreren Konten (Google Workspace, z. B. `Amin.douioui@prozessia.de`).
Mehrere Postfächer wechseln sich bei Erstmails ab (Rotation); Follow-ups gehen immer über das Postfach der Erstmail.
Angefordert werden **„E-Mails senden“** (`gmail.send`), **„Kopfzeilen lesen“** (`gmail.metadata`) sowie `openid` und `email`.
Letzteres liefert die Adresse des verbundenen Kontos (gmail.send erlaubt kein Profil-Lesen). `gmail.metadata` braucht der
E-Mail-Flow, um vor jedem Follow-up zu prüfen, ob der Lead im Thread geantwortet hat – Mail-Inhalte sind damit nicht lesbar.

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
4. **Datenzugriff / Bereiche → Bereiche hinzufügen**: `https://www.googleapis.com/auth/gmail.send`,
   `https://www.googleapis.com/auth/gmail.metadata` (unter „Gmail API“: „E-Mails senden“ und
   „E-Mail-Metadaten wie Labels und Header ansehen“) sowie die nicht sensiblen Bereiche `openid` und
   `.../auth/userinfo.email` („Primäre Google-Konto-E-Mail-Adresse“ anzeigen) eintragen, speichern.
   - War Gmail schon vor dem E-Mail-Flow verbunden: Bereich `gmail.metadata` ergänzen und das Postfach unter
     **Einstellungen → Postfächer → Neu verbinden** einmal neu verbinden, sonst werden keine Follow-ups gesendet.
   - **Update auf mehrere Postfächer:** Das bisher verbundene Postfach wird automatisch übernommen, ein
     „Neu verbinden“ ist dafür **nicht** nötig. Die Bereiche `openid`/`email` müssen aber im Zustimmungsbildschirm
     stehen, bevor ein **weiteres** Postfach hinzugefügt wird (sonst meldet die App „kein ID-Token“).

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
SENDER_EMAIL=Amin.douioui@prozessia.de   # optional: Vorschlag (login_hint) beim ersten Verbinden
SENDER_NAME=Amin Douioui                 # optional: Standard-Absendername
```

`GOOGLE_REDIRECT_URI` muss **exakt** einer der in Schritt 4 eingetragenen URIs entsprechen, und `APP_URL`
muss die öffentliche Adresse sein (`https://video.DOMAIN`). Danach App (und Worker) neu starten.

## 6. Postfächer verbinden

1. Im Dashboard einloggen, **Einstellungen → Postfächer** öffnen.
2. **Postfach hinzufügen** klicken, mit dem Konto (z. B. `Amin.douioui@prozessia.de`) anmelden und die Berechtigung bestätigen.
3. Du landest wieder auf der Einstellungsseite, das Postfach erscheint in der Liste. Die Adresse liest die App aus dem
   ID-Token; der Refresh-Token wird AES-256-GCM-verschlüsselt in der Datenbank gespeichert.
4. Weitere Konten genauso hinzufügen. Je Postfach lassen sich Name, Tageslimit und eigene Signatur festlegen
   (leer = Standard-Signatur aus den Einstellungen), außerdem Pausieren, **Neu verbinden** (gleiche Adresse =
   Token aktualisieren) und **Entfernen** (Zugriff wird widerrufen; hängen schon gesendete Leads daran, bleibt der
   Eintrag deaktiviert erhalten und deren Follow-ups warten).
5. In der Kampagne unter **Vorlage** das Postfach wählen und mit „Testmail an mich senden“ prüfen, dass die Mail ankommt.

## Hinweise und Fehlersuche

- **`redirect_uri_mismatch`**: URI in der Cloud Console und `GOOGLE_REDIRECT_URI` stimmen nicht exakt überein.
- **Kein Refresh-Token**: Zugriff unter <https://myaccount.google.com/permissions> entfernen und neu verbinden.
- **Kein ID-Token / keine E-Mail-Adresse beim Hinzufügen**: Bereiche `openid` und `email` im Zustimmungsbildschirm ergänzen.
- **`invalid_grant` beim Senden** (z. B. nach Passwortänderung): Das Postfach wird in den Einstellungen als „Fehler“
  markiert und pausiert, die anderen senden weiter. Dort **Neu verbinden**.
- **Limits**: Workspace erlaubt ca. 2000 Mails/Tag über die API je Konto; die App sendet bewusst nur 30/Tag je Postfach
  (einstellbar, zusätzlich ein Gesamtlimit über alle Postfächer) mit 3–9 Minuten Abstand je Postfach. Meldet Gmail ein
  Limit (429/`rateLimitExceeded`), stoppt nur das betroffene Postfach für den Tag.
- **Zustellbarkeit**: SPF, DKIM und DMARC für prozessia.de müssen im DNS eingerichtet sein (Admin-Konsole →
  E-Mail authentifizieren). Neue Kampagnen langsam hochfahren (z. B. 10, dann 20, dann 30 pro Tag).
- Ein Wechsel des Absenderkontos: neues Postfach hinzufügen, das alte pausieren (laufende Follow-ups des alten Postfachs warten, solange es pausiert ist) bzw. entfernen.
