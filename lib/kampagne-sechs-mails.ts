import type { FollowupEingabe } from './campaigns';

// Kampagnen-Vorlage „Sechs-Mails-Sequenz“ nach der Cold-Email-Strategie von Sales Scripter (YouTube NH1DxFZw1NA):
// Bausteine statt leerem Blatt, rund 100 Wörter je Mail, Wert- oder Schmerzpunkt als Betreff (nicht salesy, nicht
// irreführend), Produkt erst in Mail 5, Call-to-Action als Feststellung statt Frage nach einem Gespräch.
// Reihenfolge: 1 Wertpunkte, 2 Wertpunkte als Geschichte, 3 Kundenbeispiel, 4 Fragen, 5 Produkt, 6 Nutzen zum Abschluss.
// Texte halten die Prozessia-Schreibregeln ein (keine Gedankenstriche, keine runden Klammern, keine behaupteten Gespräche).

export const SECHS_MAILS_NAME = 'Beschaffungsagent: Sechs-Mails-Sequenz';

/** Mail 1 = Erstmail der Kampagne, Mail 2 bis 6 = Follow-ups. */
export const SECHS_MAILS_ERSTMAIL = {
  betreff: 'Weniger Aufwand im operativen Einkauf bei {{firma}}',
  text: `{{begruessung}},

Sie bekommen sicher viele solcher Mails, deshalb zeige ich Ihnen direkt die Ergebnisse, die wir Einkaufsabteilungen wie der von {{firma}} liefern:

• Anfragen, Angebotsvergleiche und Nachfassen laufen automatisch statt per Hand
• Preise und Lieferzeiten sind je Artikel auf einen Blick vergleichbar
• Ihr Team hat mehr Zeit für Verhandlungen und Lieferantenentwicklung

Ich weiß nicht, ob Sie diese Punkte gerade verbessern möchten. Lassen Sie uns einen Termin vereinbaren, um zu besprechen, wie wir anderen Einkaufsabteilungen Zeit im operativen Einkauf zurückgeben.`,
};

export const SECHS_MAILS_FOLLOWUPS: (FollowupEingabe & { betreff: string })[] = [
  {
    // Mail 2: dieselben Nutzenpunkte als zusammenhängende Geschichte, mit Schmerzpunkt im Betreff
    waitDays: 3,
    betreff: 'Angebotsvergleich und Nachfassen kosten Einkäufer Zeit',
    body: `{{begruessung}},

wir helfen Einkaufsabteilungen, ihren operativen Aufwand deutlich zu senken, indem Anfragen, Angebotsvergleiche und Nachfassen automatisch laufen. Das entlastet nicht nur jeden Einkäufer im Team, es macht auch Preise und Lieferzeiten je Artikel sofort vergleichbar und verkürzt die Zeit bis zur Bestellung.

Am Ende bleibt mehr Zeit für Verhandlungen und für den Aufbau besserer Lieferantenbeziehungen, und genau dort entstehen die Einsparungen.

Wenn das für {{firma}} ein Thema ist, lassen Sie uns einen Termin vereinbaren, um zu besprechen, wie wir anderen Einkaufsabteilungen dabei helfen.`,
  },
  {
    // Mail 3: Kundenbeispiel. Die Eckdaten MÜSSEN vor dem Start durch einen echten Kunden ersetzt werden.
    waitDays: 4,
    betreff: 'Wie ein Einkaufsteam Angebotsvergleiche beschleunigt hat',
    body: `{{begruessung}},

ein Einkaufsteam aus [BRANCHE EINTRAGEN] kam zu uns, weil Anfragen und Angebotsvergleiche zu viel Zeit gebunden haben.

Wir haben den Ablauf automatisiert. Das Ergebnis:

• [ERGEBNIS 1 EINTRAGEN, z. B. Zeit pro Angebotsvergleich]
• [ERGEBNIS 2 EINTRAGEN, z. B. Anzahl manueller Nachfassmails]
• [ERGEBNIS 3 EINTRAGEN, z. B. Zeit bis zur Bestellung]

Lassen Sie uns einen Termin vereinbaren, um zu besprechen, wie wir anderen Einkaufsabteilungen zu ähnlichen Ergebnissen verhelfen.`,
  },
  {
    // Mail 4: Fragen, die wir gerne besprechen würden (keine Aufforderung zu antworten)
    waitDays: 4,
    betreff: 'Fragen zum Einkauf bei {{firma}}',
    body: `{{begruessung}},

ich habe bisher einiges zu unserer Arbeit geschrieben. Hier sind die Fragen, die ich gerne mit Ihnen besprechen würde, ohne dass Sie sie jetzt beantworten müssen:

• Wie viel Zeit geht bei Ihnen pro Woche in Anfragen und Angebotsvergleiche?
• Wie läuft das Nachfassen bei Lieferanten, wenn Angebote ausbleiben?
• Wo fehlt Ihnen heute der schnelle Überblick über Preise und Lieferzeiten?
• Was würde Ihr Team mit der gewonnenen Zeit anfangen?

Wenn Sie möchten, lassen Sie uns einen Termin vereinbaren, um genau darüber zu sprechen.`,
  },
  {
    // Mail 5: erst jetzt das Produkt, mit dem persönlichen Video
    waitDays: 5,
    betreff: 'Der Beschaffungsagent für {{firma}}',
    body: `{{begruessung}},

bisher ging es um Nutzen und Fragen, jetzt zeige ich Ihnen, womit wir das umsetzen. Der Beschaffungsagent von Prozessia übernimmt Anfragen, vergleicht Angebote und fasst nach, während Ihr Team die Entscheidungen trifft.

Ich habe dazu ein kurzes Video für {{firma}} aufgenommen:

{{vorschaubild}}

Lassen Sie uns einen Termin vereinbaren, um zu besprechen, wie der Beschaffungsagent bei Ihnen aussehen könnte.`,
  },
  {
    // Mail 6: zurück zu den Nutzenpunkten, letzte Mail der Sequenz
    waitDays: 6,
    betreff: 'Mehr Zeit für Verhandlungen statt Routine',
    body: `{{begruessung}},

zum Abschluss noch einmal kurz, was Einkaufsabteilungen von uns haben:

• Weniger manueller Aufwand bei Anfragen, Angebotsvergleichen und Nachfassen
• Preise und Lieferzeiten schneller vergleichbar
• Mehr Zeit für Verhandlungen und Lieferantenentwicklung

Falls das für {{firma}} gerade nicht passt, ist das kein Problem. Sonst lassen Sie uns einen Termin vereinbaren, um zu besprechen, wie wir anderen Einkaufsabteilungen helfen.`,
  },
];

/** Platzhalter, die vor dem Versand durch echte Angaben (Kundenbeispiel) ersetzt werden müssen. */
export const OFFENE_MARKER = /\[[A-ZÄÖÜ ]+EINTRAGEN[^\]]*\]/g;
