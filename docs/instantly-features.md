# Instantly-ähnliche Funktionen – Umsetzungsplan

Ziel: Funktionen, die Instantly.ai als Cold-Outreach-Tool bietet, in die bestehende App bringen – ohne die
Grundregeln aus `BRIEFING.md` zu brechen (ein Server, SQLite, ein Worker, keine externen Dienste außer Gmail,
TypeScript strikt, UI-Texte und Kommentare auf Deutsch).

Umsetzung in sechs Paketen, nacheinander (jedes Paket kann eine Drizzle-Migration erzeugen; parallele
Migrationen würden kollidieren). Jedes Paket endet mit grünem `typecheck`, `lint`, `test` und `build`.

## Paket 1 – Vorlagen: Spintax, eigene Variablen, Fallbacks

- **Spintax** `{Hallo|Guten Tag|Moin}`: pro Lead deterministisch gewählt (Seed = Slug + Schritt), damit Vorschau
  und Versand identisch sind. Verschachtelung erlaubt. Gilt für Betreff und Text (Erstmail + Follow-ups).
  Darf nicht mit `{{platzhalter}}` kollidieren.
- **Eigene Variablen**: Alle nicht zugeordneten Spalten des Imports landen bereits in `leads.extra`; sie werden
  als `{{spaltenname}}` (normalisiert: klein, Leer-/Sonderzeichen → `_`) nutzbar. Zusätzlich `{{position}}`,
  `{{website}}`, `{{email}}`, `{{absender_name}}`.
- **Fallback** `{{vorname|Hallo zusammen}}`: wenn leer, Fallback-Text.
- Vorlagen-Editor zeigt verfügbare Variablen inkl. der Extra-Spalten der Kampagne und eine Spintax-Hilfe;
  Warnung bei unbekannten Platzhaltern.

## Paket 2 – A/B-Tests (Varianten der Erstmail)

- Tabelle `varianten` (Kampagne, Kürzel A/B/C…, Betreff, Text, aktiv). Ohne Varianten gilt die bisherige Vorlage
  (= Variante A). `leads.variante` speichert die beim Versand zugewiesene Variante (gleichmäßig rotierend).
- Editor: Varianten anlegen/ändern/deaktivieren, Vorschau je Variante.
- Statistik je Variante: gesendet, Video angesehen, Play, Termin-Klick, Antworten, Raten.

## Paket 3 – Lead-Status, Antworten-Postfach, Firmen-Stopp, globale Lead-Suche

- **Lead-Status** (wie Instantly „Lead Status“): `offen`, `interessiert`, `termin_gebucht`, `spaeter`,
  `nicht_interessiert`, `falscher_ansprechpartner`, `gewonnen`, `verloren`. In Tabelle filterbar, im Lead-Detail
  änderbar. „Nicht interessiert“/„Gewonnen“/„Verloren“ etc. stoppen den Flow (keine Follow-ups mehr).
- **Antworten-Postfach** `/antworten` (Unibox light, da nur `gmail.metadata`): alle Leads mit erkannter Antwort
  über alle Kampagnen, neueste zuerst, Link „In Gmail öffnen“ (Thread-ID), Status setzen, Notiz, „gelesen“.
  Zähler ungelesener Antworten in der Navigation.
- **Firmen-Stopp** (Instantly „stop on company reply“): Kampagnen-Option; antwortet jemand einer Domain, stoppen
  die Flows aller Leads mit derselben E-Mail-Domain in dieser Kampagne (Freemail-Domains ausgenommen).
- **Leads-Seite** `/leads`: kampagnenübergreifende Suche/Filter (Status, Kampagne, Antwort, Score).

## Paket 4 – Analytics

- Kampagnen-Analyse `/kampagnen/[id]/analyse`: Trichter (Leads → gesendet → Video-Seite → Play → 50 % → Termin-Klick
  → Antwort), Raten, Bounces, Abmeldungen; je Schritt (Erstmail, Follow-up n): gesendet, Antworten danach;
  Tagesverlauf (gesendet/Antworten/Ansichten) als einfaches Balkendiagramm ohne Zusatz-Lib; A/B-Vergleich.
- Übersicht (Startseite): Kennzahlen über alle Kampagnen + letzte 14 Tage.

## Paket 5 – Zeitplan & Zustellbarkeit

- Versandtage frei wählbar (Mo–So) statt nur „werktags“, optionales **Startdatum** der Kampagne.
- **Neue Leads pro Tag** je Kampagne (getrennt vom Gesamtlimit, Follow-ups haben Vorrang).
- **Automatische Aufwärmrampe** (Instantly „slow ramp“): global aktivierbar, Startwert, Steigerung pro Tag, bis
  zum Tageslimit; Berechnung ab erstem Versandtag.
- **Domain-Sperrliste**: Einträge `@firma.de` sperren ganze Domains (Import, Versand).
- **MX-Prüfung beim Import**: Domains ohne MX-Eintrag als „nicht zustellbar“ markieren (per `dns.resolveMx`,
  injizierbar für Tests, Zeitlimit, Cache je Domain).
- Kampagne duplizieren (Vorlage, Follow-ups, Varianten, Einstellungen – ohne Leads).

## Paket 6 – Mehrere Absender-Postfächer mit Rotation

- Tabelle `absender` (E-Mail, Name, verschlüsselter Refresh-Token, Scopes, Tageslimit, aktiv, eigene Signatur
  optional). Bestehende Verbindung aus `settings` wird beim Start als erstes Postfach übernommen.
- „Postfach hinzufügen“ (OAuth, Scope zusätzlich `openid email`, E-Mail aus dem ID-Token), Liste mit Status,
  Tageslimit, Pausieren, Entfernen.
- **Rotation**: Erstmail über das aktive Postfach mit den wenigsten heutigen Mails unter seinem Limit; Abstand je
  Postfach; Follow-ups und Antwortprüfung immer über das Postfach der Erstmail (`leads.absender_id`).
- Quota-/Auth-Fehler betreffen nur das jeweilige Postfach. Aufwärmrampe gilt je Postfach.
