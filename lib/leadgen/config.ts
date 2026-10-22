// Konfiguration der Lead-Pipeline: Standardwerte, die sich per Einstellung überschreiben lassen sollen (Rollen-Synonyme,
// Suchvorlagen, Schwellen, Gewichte, Intervalle). Alles hier ist bewusst Daten, kein Code, damit Anpassungen ohne Umbau gehen.

export type RollenDefinition = {
  /** Schlüssel, z. B. „einkauf_leitung“ */
  key: string;
  label: string;
  /** Alle Bezeichnungen, die als diese Rolle gelten (Groß-/Kleinschreibung und Umlaute egal) */
  synonyme: string[];
  /** Nächsthöhere passende Rollen, in dieser Reihenfolge, wenn die Rolle selbst nicht gefunden wird (Fallback, wird als solcher markiert) */
  fallbacks: string[];
};

export const STANDARD_ROLLEN: RollenDefinition[] = [
  {
    key: 'einkauf_leitung',
    label: 'Einkaufsleiter',
    synonyme: [
      'Einkaufsleiter', 'Leiter Einkauf', 'Leitung Einkauf', 'Einkaufsleitung', 'Leiter Beschaffung', 'Beschaffungsleiter', 'Leiter Materialwirtschaft',
      'Head of Procurement', 'Head of Purchasing', 'Purchasing Manager', 'Procurement Manager', 'Director Procurement', 'Leiter strategischer Einkauf',
      'Leiter Zentraleinkauf', 'Abteilungsleiter Einkauf', 'Bereichsleiter Einkauf',
    ],
    fallbacks: ['geschaeftsfuehrung'],
  },
  {
    key: 'fertigung_leitung',
    label: 'Leiter Fertigung',
    synonyme: [
      'Leiter Fertigung', 'Fertigungsleiter', 'Leitung Fertigung', 'Fertigungsleitung', 'Leiter Produktion', 'Produktionsleiter', 'Leitung Produktion', 'Produktionsleitung',
      'Betriebsleiter', 'Werkleiter', 'Head of Production', 'Head of Manufacturing', 'Production Manager', 'Manufacturing Manager', 'Werkstattleiter',
    ],
    fallbacks: ['geschaeftsfuehrung'],
  },
  {
    key: 'technik_leitung',
    label: 'Technischer Leiter',
    synonyme: ['Technischer Leiter', 'Leiter Technik', 'Technischer Geschäftsführer', 'Leiter Konstruktion', 'Konstruktionsleiter', 'Head of Engineering', 'CTO', 'Leiter Entwicklung'],
    fallbacks: ['geschaeftsfuehrung'],
  },
  {
    key: 'vertrieb_leitung',
    label: 'Vertriebsleiter',
    synonyme: ['Vertriebsleiter', 'Leiter Vertrieb', 'Leitung Vertrieb', 'Head of Sales', 'Sales Manager', 'Vertriebsleitung', 'Leiter Verkauf', 'Verkaufsleiter'],
    fallbacks: ['geschaeftsfuehrung'],
  },
  {
    key: 'geschaeftsfuehrung',
    label: 'Geschäftsführer',
    synonyme: ['Geschäftsführer', 'Geschäftsführung', 'Geschäftsführender Gesellschafter', 'Managing Director', 'CEO', 'Inhaber', 'Vorstand', 'Vorstandsvorsitzender', 'Gründer', 'Prokurist'],
    fallbacks: [],
  },
];

/** Suchvorlagen für die gezielte Personensuche; {rolle}, {firma}, {ort} werden eingesetzt. `tag` benennt die Quelle im Ergebnis. */
export type Suchvorlage = { tag: 'suche' | 'stellenanzeige' | 'presse' | 'messe' | 'netzwerk'; vorlage: string };

export const STANDARD_SUCHVORLAGEN: Suchvorlage[] = [
  { tag: 'suche', vorlage: '"{rolle}" "{firma}"' },
  { tag: 'suche', vorlage: '{firma} {rolle} Ansprechpartner {ort}' },
  { tag: 'stellenanzeige', vorlage: '{firma} Stellenanzeige {rolle} Ansprechpartner' },
  { tag: 'presse', vorlage: '{firma} Pressemitteilung {rolle}' },
  { tag: 'messe', vorlage: '{firma} Aussteller {rolle} Ansprechpartner' },
  { tag: 'netzwerk', vorlage: 'site:linkedin.com/in "{firma}" "{rolle}"' },
  { tag: 'netzwerk', vorlage: 'site:xing.com/profile "{firma}" "{rolle}"' },
];

/** Postfächer ohne Personenbezug */
export const GENERISCHE_POSTFAECHER = [
  'info', 'kontakt', 'office', 'mail', 'post', 'zentrale', 'sekretariat', 'vertrieb', 'einkauf', 'verkauf', 'service', 'support', 'buchhaltung', 'verwaltung', 'empfang',
  'anfrage', 'anfragen', 'bewerbung', 'bewerbungen', 'jobs', 'karriere', 'hello', 'hallo', 'sales', 'contact', 'admin', 'webmaster', 'datenschutz', 'impressum', 'team',
  'order', 'bestellung', 'rechnung', 'rechnungen', 'marketing', 'presse', 'procurement', 'purchasing', 'beschaffung', 'produktion', 'fertigung', 'technik', 'qualitaet',
];

/** Rollenspezifische generische Postfächer (letzter Fallback), vor den allgemeinen */
export const GENERISCHE_FUER_ROLLE: Record<string, string[]> = {
  einkauf_leitung: ['einkauf', 'beschaffung', 'procurement', 'purchasing'],
  fertigung_leitung: ['fertigung', 'produktion'],
  technik_leitung: ['technik'],
  vertrieb_leitung: ['vertrieb', 'sales'],
};

export const ALLGEMEINE_GENERISCHE = ['info', 'kontakt', 'office', 'mail'];

export const KONTAKT_SCHWELLEN = {
  /** Ab dieser Gesamt-Konfidenz endet die Kette der Schritte vorzeitig */
  ausreichend: 0.6,
  /** Höchstens so viele Adress-Kandidaten je Person werden verifiziert */
  maxVerifizierungen: 8,
  /** Konfidenz einer verifizierten E-Mail (Server hat den Empfänger bestätigt) */
  emailVerifiziert: 0.97,
  /** Catch-All-Domain: Adresse nach bestem Muster, nicht verifizierbar */
  catchAllBestGuess: 0.4,
  generischVerifiziert: 0.5,
  generischUnverifiziert: 0.3,
} as const;

/** Wie lange eine Verifizierung gilt (Tage); ‚unbekannt‘ wird früher wiederholt */
export const VERIFIZIERUNG_GUELTIG_TAGE = 30;
export const VERIFIZIERUNG_UNBEKANNT_STUNDEN = 24;
/** Mindestabstand zwischen zwei Prüfungen derselben Zieldomain */
export const VERIFIZIERUNG_ABSTAND_MS = 2000;
/** Erneute Anreicherung, wenn die Rolle offen blieb (Tage) */
export const ROLLE_OFFEN_WIEDERHOLUNG_TAGE = 7;
