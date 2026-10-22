import type { BEOBACHTUNG_TYP } from '@/db/schema';

// Gemeinsame Typen der Lead-Pipeline

/** Unverändertes Rohdokument einer Quelle (Stufe 1). `referenz` = ID im Quellsystem, `inhalt` = Originaltext. */
export type RawDocument = {
  quelle: string;
  referenz: string;
  url?: string;
  contentType?: string;
  inhalt: string;
};

/** Jede Quelle ist ein Connector mit demselben Interface; `fetch()` liefert die Rohdokumente nacheinander (Stream, kein Komplett-Laden). */
export interface Connector {
  readonly quelle: string;
  fetch(): AsyncIterable<RawDocument>;
}

export type Rechtsform = string;

export type PersonenRolle = 'geschaeftsfuehrer' | 'vorstand' | 'prokurist' | 'inhaber' | 'liquidator' | 'gesellschafter' | 'sonstige';

export type NormalisiertePerson = {
  vorname: string | null;
  nachname: string;
  titel: string[];
  rolle: PersonenRolle;
  /** Rollenbezeichnung wie in der Quelle */
  rolleOriginal: string | null;
};

export type NormalisierteAdresse = {
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  bundesland: string | null;
  /** 'quelle' = von der Quelle geliefert, 'plz' = nur aus der Postleitzahl abgeleitet (unsicherer) */
  bundeslandHerkunft: 'quelle' | 'plz' | null;
};

/** Ergebnis der Normalisierung eines Registersatzes (vor der Entity Resolution) */
export type NormalisierterSatz = {
  quelle: string;
  referenz: string;
  name: string;
  rechtsform: Rechtsform | null;
  nameNormalized: string;
  registerart: string | null;
  registernummer: string | null;
  registergericht: string | null;
  sitz: string | null;
  adresse: NormalisierteAdresse | null;
  status: string | null;
  personen: NormalisiertePerson[];
  /** Mitarbeiterzahl bzw. Größenklasse aus einem Jahresabschluss (Bundesanzeiger); `stichtag` = Bilanzstichtag (Unix-ms), maßgeblich für das Alter der Angabe */
  mitarbeiter?: { zahl: number | null; klasse: 'hgb_klein' | 'hgb_mittel' | 'hgb_gross' | null; stichtag: number | null };
  umsatzEur?: number | null;
  /** Datenstand der Quelle (Unix-ms), z. B. `retrieved_at` im OffeneRegister-Dump: das Alter der Angaben, nicht der Zeitpunkt des Imports */
  datenStand?: number | null;
};

export type NeueBeobachtung = {
  entityType: 'company' | 'person' | 'contact_point';
  feld: string;
  wert: unknown;
  konfidenz: number;
  typ?: (typeof BEOBACHTUNG_TYP)[number];
  /** Zeitpunkt, auf den sich die Angabe bezieht (z. B. Bilanzstichtag); Standard: jetzt */
  beobachtetAm?: number;
};
