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

// ---------------------------------------------------------------- Golden Record: Survivorship, Decay

export type FeldArt = 'stammdaten' | 'adresse' | 'person' | 'mitarbeiter' | 'branche' | 'domain';

/**
 * Quellenrangfolge je Feldart (vorn = gewinnt). Register schlägt Webseite für Geschäftsführer; der alte OffeneRegister-Bestand
 * (Datenstand ~2019) ist nur Seed: er steht bei Adresse und Person hinter der Webseite und verliert zusätzlich über den Decay.
 * Unbekannte Quellen stehen ganz hinten; ein Präfix („suche:“) gilt für alle Quellen mit diesem Präfix.
 */
export const QUELLEN_RANG: Record<FeldArt, string[]> = {
  stammdaten: ['handelsregister', 'northdata', 'bundesanzeiger', 'offeneregister', 'web', 'suche:'],
  adresse: ['handelsregister', 'northdata', 'web', 'offeneregister', 'suche:'],
  person: ['handelsregister', 'northdata', 'web', 'suche:', 'offeneregister'],
  mitarbeiter: ['bundesanzeiger', 'northdata', 'handelsregister', 'web', 'suche:', 'offeneregister'],
  branche: ['web', 'handelsregister', 'northdata', 'offeneregister'],
  domain: ['suche:', 'web'],
};

/** Welche Beobachtungsfelder zu welcher Feldart gehören */
export const FELD_ART: Record<string, FeldArt> = {
  name: 'stammdaten', rechtsform: 'stammdaten', name_normalized: 'stammdaten', registerart: 'stammdaten', registernummer: 'stammdaten', registergericht: 'stammdaten', sitz: 'stammdaten', status: 'stammdaten',
  strasse: 'adresse', plz: 'adresse', ort: 'adresse', bundesland: 'adresse',
  person: 'person',
  mitarbeiter: 'mitarbeiter',
  branche_web: 'branche', branche_wz: 'branche',
  domain: 'domain',
};

/** Mitarbeiterzahlen: exakt schlägt Größenklasse schlägt Schätzung, unabhängig von der Quelle */
export const TYP_RANG = { exakt: 0, klasse: 1, schaetzung: 2 } as const;

/** Halbwertszeit der Konfidenz in Tagen: danach zählt eine Beobachtung nur noch halb. */
export const HALBWERTSZEIT_TAGE: Record<string, number> = {
  email: 90,
  email_pruefung: 30,
  telefon: 540,
  person: 365,
  registernummer: 3650,
  registerart: 3650,
  registergericht: 3650,
  name: 1095,
  rechtsform: 1095,
  strasse: 730,
  plz: 730,
  ort: 730,
  sitz: 730,
  bundesland: 1095,
  mitarbeiter: 730,
  branche_web: 1095,
  branche_wz: 1825,
  domain: 730,
};
export const STANDARD_HALBWERTSZEIT_TAGE = 365;
/** Unter diesen Anteil der ursprünglichen Konfidenz sinkt eine Beobachtung durch den Decay nie (sie bleibt erkennbar, verliert aber den Vorrang) */
export const DECAY_UNTERGRENZE = 0.2;

// ---------------------------------------------------------------- Scoring

export const DATEN_SCORE_GEWICHTE = { vollstaendigkeit: 0.3, konfidenz: 0.25, email: 0.3, aktualitaet: 0.15 } as const;

/** Beitrag der E-Mail-Verlässlichkeit zum Datenqualitäts-Score */
export const EMAIL_STATUS_WERT: Record<string, number> = { gueltig: 1, catch_all_best_guess: 0.35, generisch: 0.25, generisch_unverifiziert: 0.12 };

export type IcpKonfig = {
  /** Gewichte der Dimensionen; werden auf Summe 1 normiert */
  gewichte: { branche: number; mitarbeiter: number; region: number; rechtsform: number };
  /** Zielbranchen mit Passung 0 bis 1 (Taxonomie-Schlüssel) */
  branchen: Record<string, number>;
  mitarbeiterMin: number;
  mitarbeiterMax: number;
  /** Zielregionen: Bundesländer und/oder PLZ-Präfixe; leer = ganz Deutschland */
  bundeslaender: string[];
  plzPraefixe: string[];
  /** Passung je Rechtsform (0 bis 1); nicht aufgeführte Formen: `rechtsformStandard` */
  rechtsformen: Record<string, number>;
  rechtsformStandard: number;
};

export const STANDARD_ICP: IcpKonfig = {
  gewichte: { branche: 0.4, mitarbeiter: 0.3, region: 0.15, rechtsform: 0.15 },
  branchen: { werkzeugbau: 1, formenbau: 1, maschinenbau: 0.9, sonstige_fertigung: 0.5, keine_fertigung: 0 },
  mitarbeiterMin: 100,
  mitarbeiterMax: 800,
  bundeslaender: [],
  plzPraefixe: [],
  rechtsformen: { GmbH: 1, 'GmbH & Co. KG': 1, AG: 0.9, KG: 0.8, 'GmbH & Co. KGaA': 0.8, KGaA: 0.8, SE: 0.8, 'UG (haftungsbeschränkt)': 0.4, OHG: 0.6, GbR: 0.3, 'e.K.': 0.3, gGmbH: 0.2, 'e.V.': 0, eG: 0.3 },
  rechtsformStandard: 0.5,
};

/** Unbekannte Angaben zählen bei der ICP-Passung neutral-niedrig, damit unvollständige Leads nicht vorn stehen */
export const ICP_UNBEKANNT = 0.3;
