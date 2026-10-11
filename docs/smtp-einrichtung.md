# SMTP/IMAP-Postfächer einrichten (Outlook, IONOS, Strato, web.de, GMX, …)

Neben Gmail kann das Dashboard über jedes Postfach mit SMTP-Versand und IMAP-Zugang senden. Rotation, Tageslimits,
Aufwärmrampe, Bounce-Schutz, Abstand, Antwort-Erkennung, Unibox, KI-Einordnung und Webhooks funktionieren genauso wie bei
Gmail-Postfächern. Das Hinzufügen ist **Admins vorbehalten** (die Server-Hosts sind frei wählbar).

## Einrichten

1. **Einstellungen → Postfächer → „SMTP/IMAP-Postfach hinzufügen“.**
2. Anbieter-Voreinstellung wählen (füllt Server, Ports und Verschlüsselung), E-Mail-Adresse und Passwort eintragen.
   Der Benutzername ist meist die vollständige Adresse (leer = Adresse). Das IMAP-Passwort darf leer bleiben, dann gilt das SMTP-Passwort.
3. **„Verbindung testen“** meldet sich am SMTP- und am IMAP-Server an. Es wird **nichts gesendet**. Fehler erscheinen auf Deutsch
   (falsches Passwort, Server nicht erreichbar, Zertifikat/Verschlüsselung passt nicht).
4. **Speichern.** Mit einer Testmail (Kampagne → Vorschau → „Testmail“) prüfen, dass der Versand klappt.

Beim **Bearbeiten** bleiben die Passwortfelder leer, solange sich das Passwort nicht ändert (leer = unverändert). Passwörter werden
nie wieder angezeigt oder an den Browser zurückgegeben; gespeichert werden sie mit AES-256-GCM (`ENCRYPTION_KEY`) verschlüsselt als
ein JSON `{smtpPasswort, imapPasswort}` in `absender.zugangsdaten_enc`. **Wird der `ENCRYPTION_KEY` geändert, sind die Passwörter
nicht mehr lesbar** – das Postfach meldet dann einen Fehler und muss über „Bearbeiten“ neu eingetragen werden (gilt ebenso für Gmail-Tokens).

| Anbieter | SMTP | IMAP | Besonderheiten |
| --- | --- | --- | --- |
| Outlook / Microsoft 365 | `smtp.office365.com`, 587, STARTTLS | `outlook.office365.com`, 993, SSL | siehe unten |
| IONOS | `smtp.ionos.de`, 465, SSL | `imap.ionos.de`, 993, SSL | Benutzername = volle Adresse |
| Strato | `smtp.strato.de`, 465, SSL | `imap.strato.de`, 993, SSL | Benutzername = volle Adresse |
| web.de | `smtp.web.de`, 587, STARTTLS | `imap.web.de`, 993, SSL | POP3/IMAP-Abruf in den Einstellungen erlauben; strenge Limits |
| GMX | `mail.gmx.net`, 587, STARTTLS | `imap.gmx.net`, 993, SSL | POP3/IMAP-Abruf in den Einstellungen erlauben; strenge Limits |

**Verschlüsselung:** „SSL/TLS“ verbindet direkt verschlüsselt (Ports 465/993), „STARTTLS“ stellt auf der Standardverbindung auf TLS um
(587/143) und bricht ab, wenn der Server das nicht anbietet. **„Keine Verschlüsselung“** sendet Passwort und Mails im Klartext – die Oberfläche
warnt davor; nur in einem vertrauenswürdigen internen Netz verwenden.

## Microsoft 365 / Outlook – Einschränkungen

- **SMTP AUTH muss aktiviert sein.** Microsoft hat die einfache Anmeldung (Basic Authentication) für SMTP in vielen Tenants abgeschaltet.
  Im Exchange Admin Center: Postfach → *E-Mail-Apps verwalten* → „Authentifiziertes SMTP“ aktivieren (oder tenantweit
  `Set-TransportConfig -SmtpClientAuthenticationDisabled $false`). Gleiches gilt für **IMAP** (Postfach → E-Mail-Apps → IMAP).
- Bei aktivierter **Zwei-Faktor-Anmeldung** ist ein **App-Passwort** nötig (Konto → Sicherheit → App-Kennwörter). Reine **OAuth-/Modern-Auth-Anmeldung wird
  hier nicht unterstützt**; ist Basic Auth im Tenant gesperrt (Sicherheitsstandards, Conditional Access), funktioniert dieses Postfach nur über Gmail/anderen Anbieter.
- Persönliche Outlook.com-/Hotmail-Konten verlangen ebenfalls ein App-Passwort; Microsoft begrenzt dort die Sendemenge stark.
- Microsoft 365 legt gesendete Mails über SMTP selbst in „Gesendete Elemente“ ab – die Option „Kopie im Gesendet-Ordner ablegen“ ist in der Vorlage deshalb aus.
- Limits: etwa 30 Mails pro Minute und 10 000 Empfänger pro Tag je Postfach; das Tageslimit des Postfachs im Dashboard bewusst niedrig halten.
  Meldet der Server ein Sendelimit (z. B. `5.4.5 Daily user sending quota exceeded`), stoppt nur dieses Postfach für den Tag.

## Wie Antworten erkannt werden

Bei SMTP gibt es keine Threads. Der „Thread“ eines Leads ist die **Message-ID der Erstmail** (`gmail_thread_id = smtp:<Message-ID>`).
Pro Prüfdurchlauf wird **eine** IMAP-Verbindung geöffnet (Zeitlimit 60 s, danach hart getrennt) und im **Posteingang** gesucht:

- **Antwort:** eine Nachricht, deren `In-Reply-To` oder `References` eine unserer gesendeten Message-IDs des Leads enthält, **oder** deren Absender die Adresse
  des Leads ist und deren Datum nach der Erstmail liegt.
- **Bounce:** Absender `mailer-daemon`/`postmaster` bzw. `multipart/report` (delivery-status) – aber nur, wenn der Bericht **unsere Message-ID** nennt.
  Ein Bounce zu einer anderen Mail im selben Postfach stoppt diesen Lead nicht.
- **Abwesenheitsnotiz:** automatische Antworten (Header `Auto-Submitted`, `X-Autoreply`, `Precedence`, Betreff-Muster) zählen nicht als Antwort; die Follow-ups warten.
- Der Spam-Ordner wird nicht durchsucht. Antworten, die der Anbieter dort einsortiert, werden nicht erkannt.

Damit die **Unibox** den Verlauf vollständig zeigt, braucht sie auch die gesendeten Mails: Der Treiber legt nach dem Versand eine Kopie im IMAP-Ordner
„Gesendet“ ab (Ordner per SPECIAL-USE `\Sent`, sonst nach Namen wie „Sent“/„Gesendet“). Schlägt das fehl, gilt die Mail trotzdem als gesendet; der Verlauf
zeigt dann nur die Antworten des Leads. Bei Anbietern, die gesendete Mails selbst speichern (Microsoft 365), die Option abschalten, sonst entstehen Dubletten.

**Fehler:** Anmeldefehler (SMTP oder IMAP) pausieren das Postfach mit Meldung, bis die Zugangsdaten unter *Bearbeiten* geprüft und gespeichert wurden.
Netzwerkfehler und Zeitüberschreitungen sind vorübergehend; die Prüfung wird später erneut versucht, es wird kein Postfach pausiert.

## SPF, DKIM und DMARC je Anbieter

Ohne saubere Authentifizierung landen Kaltmails im Spam – **unabhängig vom Versandweg** der App. Die DNS-Einträge liegen bei dem Anbieter,
der die Domain verwaltet (nicht in der App). Mit dem Postfach `info@beispiel.de` bei Anbieter X:

- **SPF** (TXT auf `beispiel.de`): genau **ein** `v=spf1`-Eintrag, der den Versandweg des Anbieters einschließt. Microsoft 365: `include:spf.protection.outlook.com`,
  IONOS: `include:_spf-eu.ionos.com`, Strato: `include:spf.strato.de`, Google Workspace: `include:_spf.google.com`; web.de/GMX sind für eigene Domains nicht vorgesehen
  (die Absenderdomain `web.de`/`gmx.de` gehört dem Anbieter, SPF/DKIM stimmen dort automatisch). Mehrere Versandwege = mehrere `include:` in **einem** Eintrag, am Ende `~all` oder `-all`.
- **DKIM:** wird vom Anbieter signiert, wenn aktiviert. Microsoft 365: Defender-Portal → *E-Mail & Zusammenarbeit → Richtlinien → DKIM* → Domain aktivieren und die beiden
  `selector1`/`selector2`-CNAMEs setzen. IONOS/Strato: im Kundenbereich unter der E-Mail-/Domain-Verwaltung „DKIM“ aktivieren und den angezeigten Eintrag setzen
  (nicht bei jedem Tarif möglich). Google Workspace: Admin-Konsole → Apps → Gmail → E-Mails authentifizieren.
- **DMARC** (TXT auf `_dmarc.beispiel.de`): zum Einstieg `v=DMARC1; p=none; rua=mailto:dmarc@beispiel.de`, nach einigen Wochen ohne Auffälligkeiten auf `p=quarantine` anheben.
  Absender-Domain (`From`) und SPF-/DKIM-Domain müssen zusammenpassen („Alignment“).
- **Prüfen:** eine Testmail an ein Gmail-Konto senden → *Original anzeigen*: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
- Die App sendet `List-Unsubscribe` und `List-Unsubscribe-Post` (One-Click); die Mail wird 1:1 durchgereicht. Ein Anbieter kann zusätzliche Hinweise anfügen oder
  strengere Limits setzen (Spam-Schutz von IONOS/Strato/web.de/GMX): klein anfangen, Aufwärmrampe in den Einstellungen nutzen, die Bounce-Quote beobachten.
