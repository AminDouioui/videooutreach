import { splitName } from './name';

/** Zielfelder des Imports */
export const IMPORT_FELDER = ['name', 'vorname', 'nachname', 'anrede', 'firma', 'email', 'position', 'website'] as const;
export type ImportFeld = (typeof IMPORT_FELDER)[number];

/** Zielfeld → Spaltenname der Datei (oder null = nicht zugeordnet) */
export type Mapping = Record<ImportFeld, string | null>;
export type Row = Record<string, string>;

export const FELD_LABELS: Record<ImportFeld, string> = {
  name: 'Name (voller Name)',
  vorname: 'Vorname',
  nachname: 'Nachname',
  anrede: 'Anrede',
  firma: 'Firma',
  email: 'E-Mail',
  position: 'Position',
  website: 'Website',
};

const SYNONYME: Record<ImportFeld, string[]> = {
  name: ['name', 'ansprechpartner', 'kontakt', 'kontaktperson'],
  vorname: ['vorname', 'firstname'],
  nachname: ['nachname', 'familienname', 'lastname'],
  anrede: ['anrede', 'salutation'],
  firma: ['firma', 'unternehmen', 'company', 'firmenname'],
  email: ['email', 'mail', 'emailadresse'],
  position: ['position', 'funktion', 'jobtitel'],
  website: ['website', 'webseite', 'url', 'homepage'],
};

/** Vergleichsform: lowercase, ohne Leerzeichen/Bindestriche/Unterstriche */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, '');
}

/** Rät die Zuordnung Zielfeld → Spalte anhand der Spaltennamen. Jede Spalte wird höchstens einmal vergeben. */
export function guessMapping(headers: string[]): Mapping {
  const mapping = Object.fromEntries(IMPORT_FELDER.map((f) => [f, null])) as Mapping;
  const belegt = new Set<string>();
  for (const feld of IMPORT_FELDER) {
    const kandidaten = SYNONYME[feld];
    // Reihenfolge der Synonyme bestimmt die Priorität
    for (const syn of kandidaten) {
      const treffer = headers.find((h) => !belegt.has(h) && norm(h) === syn);
      if (treffer !== undefined) {
        mapping[feld] = treffer;
        belegt.add(treffer);
        break;
      }
    }
  }
  return mapping;
}

export type MappedLead = {
  firma: string;
  anrede: string;
  vorname: string;
  nachname: string;
  email: string;
  position: string;
  website: string;
  extra: Record<string, string>;
};

function wert(row: Row, spalte: string | null): string {
  if (!spalte) return '';
  return (row[spalte] ?? '').toString().trim();
}

/** Wendet das Mapping auf eine Zeile an; nicht zugeordnete Spalten landen in `extra`. */
export function applyMapping(row: Row, mapping: Mapping): MappedLead {
  let vorname = wert(row, mapping.vorname);
  let nachname = wert(row, mapping.nachname);
  const vollerName = wert(row, mapping.name);
  if (vollerName && !mapping.vorname && !mapping.nachname) {
    ({ vorname, nachname } = splitName(vollerName));
  } else if (vollerName && !vorname && !nachname) {
    ({ vorname, nachname } = splitName(vollerName));
  }

  const benutzt = new Set(Object.values(mapping).filter((v): v is string => !!v));
  const extra: Record<string, string> = {};
  for (const [spalte, v] of Object.entries(row)) {
    if (benutzt.has(spalte)) continue;
    const t = (v ?? '').toString().trim();
    if (t) extra[spalte] = t;
  }

  return {
    firma: wert(row, mapping.firma),
    anrede: wert(row, mapping.anrede),
    vorname,
    nachname,
    email: wert(row, mapping.email).toLowerCase(),
    position: wert(row, mapping.position),
    website: wert(row, mapping.website),
    extra,
  };
}

export const ROW_STATUS = ['ok', 'ungueltige_email', 'duplikat_datei', 'duplikat_bestand', 'gesperrt', 'fehlende_pflichtfelder'] as const;
export type RowStatus = (typeof ROW_STATUS)[number];

export type ValidatedRow = {
  /** 0-basierter Index der Zeile in der Datei (ohne Kopfzeile) */
  index: number;
  status: RowStatus;
  lead: MappedLead;
};

export type ValidationContext = {
  /** E-Mails (lowercase), die bereits in irgendeiner Kampagne existieren */
  existingEmails: Set<string>;
  /** E-Mails (lowercase) der Sperrliste */
  suppressed: Set<string>;
};

const EMAIL_REGEX = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_REGEX.test(email);
}

/** Validiert alle Zeilen. Erstes Vorkommen einer E-Mail in der Datei ist ok, weitere sind Duplikate. */
export function validateRows(rows: Row[], mapping: Mapping, ctx: ValidationContext): ValidatedRow[] {
  const gesehen = new Set<string>();
  return rows.map((row, index) => {
    const lead = applyMapping(row, mapping);
    let status: RowStatus;
    if (!lead.firma || !lead.email) status = 'fehlende_pflichtfelder';
    else if (!isValidEmail(lead.email)) status = 'ungueltige_email';
    else if (gesehen.has(lead.email)) status = 'duplikat_datei';
    else if (ctx.suppressed.has(lead.email)) status = 'gesperrt';
    else if (ctx.existingEmails.has(lead.email)) status = 'duplikat_bestand';
    else status = 'ok';
    if (status !== 'fehlende_pflichtfelder' && status !== 'ungueltige_email') gesehen.add(lead.email);
    return { index, status, lead };
  });
}

export const STATUS_LABELS: Record<RowStatus, string> = {
  ok: 'Gültig',
  ungueltige_email: 'Ungültige E-Mail',
  duplikat_datei: 'Duplikat in Datei',
  duplikat_bestand: 'Bereits vorhanden',
  gesperrt: 'Gesperrt',
  fehlende_pflichtfelder: 'Pflichtfelder fehlen',
};

export function countByStatus(rows: ValidatedRow[]): Record<RowStatus, number> {
  const counts = Object.fromEntries(ROW_STATUS.map((s) => [s, 0])) as Record<RowStatus, number>;
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

/** Deutsche Zusammenfassung, z. B. „8 gültig, 1 Duplikat, 1 ungültige E-Mail“. */
export function summarize(rows: ValidatedRow[]): string {
  const c = countByStatus(rows);
  const teile: string[] = [`${c.ok} gültig`];
  const plural = (n: number, e: string, m: string) => `${n} ${n === 1 ? e : m}`;
  if (c.duplikat_datei) teile.push(plural(c.duplikat_datei, 'Duplikat', 'Duplikate'));
  if (c.duplikat_bestand) teile.push(plural(c.duplikat_bestand, 'bereits vorhanden', 'bereits vorhanden'));
  if (c.ungueltige_email) teile.push(plural(c.ungueltige_email, 'ungültige E-Mail', 'ungültige E-Mails'));
  if (c.gesperrt) teile.push(`${c.gesperrt} gesperrt`);
  if (c.fehlende_pflichtfelder) teile.push(plural(c.fehlende_pflichtfelder, 'mit fehlenden Pflichtfeldern', 'mit fehlenden Pflichtfeldern'));
  return teile.join(', ');
}
