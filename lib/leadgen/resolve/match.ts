import { jaroWinkler } from './jaro-winkler';

// Reine Match-Logik der Entity Resolution (kein Datenbankzugriff): Blocking-Schlüssel, gewichteter Vergleich, Schwellen

export const SCHWELLEN = {
  firma: { sicher: 0.92, unsicher: 0.8 },
  person: { sicher: 0.93, unsicher: 0.85 },
} as const;

export type MatchEntscheidung = 'sicher' | 'unsicher' | 'getrennt';

export type FirmaMerkmale = {
  nameNormalized: string;
  registerKey: string | null;
  plz: string | null;
  ort: string | null;
  strasse: string | null;
  domain: string | null;
};

export type MatchErgebnis = { score: number; entscheidung: MatchEntscheidung; details: Record<string, number | null> };

/** Wörter, die in Firmennamen so häufig sind, dass sie nichts über Identität sagen (nur für Blocking, nicht für den Score) */
const FUELLWOERTER = new Set(['und', 'der', 'die', 'das', 'co', 'gmbh', 'holding', 'gruppe', 'group', 'verwaltungs', 'beteiligungs']);

export function normalisiereText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function namensTokens(nameNormalized: string): string[] {
  return normalisiereText(nameNormalized)
    .split(' ')
    .filter((t) => t.length >= 3 && !FUELLWOERTER.has(t));
}

/** Normalisierte Domain für den Vergleich („www.“ und Groß-/Kleinschreibung weg); ungültig = null. */
export function normalisiereDomain(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** Blocking: nur Firmen mit mindestens einem gemeinsamen Schlüssel werden verglichen. */
export function blockingSchluessel(m: Pick<FirmaMerkmale, 'nameNormalized' | 'registerKey' | 'plz' | 'domain'>): string[] {
  const keys = new Set<string>();
  if (m.registerKey) keys.add(`reg|${m.registerKey}`);
  const domain = normalisiereDomain(m.domain);
  if (domain) keys.add(`dom|${domain}`);
  if (m.plz) for (const t of namensTokens(m.nameNormalized)) keys.add(`plz|${m.plz}|${t}`);
  return [...keys];
}

/** Anteil übereinstimmender Wörter, wobei Wörter mit Jaro-Winkler ≥ 0,9 (Tippfehler, Endungen) als gleich gelten. */
export function weicheWortUebereinstimmung(a: string, b: string): number {
  const ta = normalisiereText(a).split(' ').filter(Boolean);
  const tb = normalisiereText(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const frei = [...tb];
  let treffer = 0;
  for (const w of ta) {
    const i = frei.findIndex((x) => jaroWinkler(w, x) >= 0.9);
    if (i >= 0) {
      treffer++;
      frei.splice(i, 1);
    }
  }
  return treffer / (ta.length + tb.length - treffer);
}

export function namensAehnlichkeit(a: string, b: string): number {
  const na = normalisiereText(a);
  const nb = normalisiereText(b);
  return 0.5 * jaroWinkler(na, nb) + 0.5 * weicheWortUebereinstimmung(na, nb);
}

type Merkmal = { gewicht: number; wert: number | null };

function kombiniere(merkmale: Record<string, Merkmal>, mindestGewicht: number): { score: number; details: Record<string, number | null> } {
  let summe = 0;
  let gewicht = 0;
  const details: Record<string, number | null> = {};
  for (const [name, m] of Object.entries(merkmale)) {
    details[name] = m.wert === null ? null : Math.round(m.wert * 1000) / 1000;
    if (m.wert === null) continue;
    summe += m.gewicht * m.wert;
    gewicht += m.gewicht;
  }
  if (gewicht === 0) return { score: 0, details };
  // Wenige vorhandene Merkmale bedeuten wenig Beweis: der Score wird entsprechend gedämpft
  return { score: (summe / gewicht) * Math.min(1, gewicht / mindestGewicht), details };
}

function vergleiche(a: string | null, b: string | null, f: (x: string, y: string) => number): number | null {
  return a && b ? f(a, b) : null;
}

/**
 * Gewichteter Firmenvergleich. Gleiche Registernummer und gleiches Gericht sind ein harter Match (1,0); zwei verschiedene
 * Registerschlüssel schließen einen Match hart aus (0). Sonst zählen Name, Straße, PLZ, Ort und Domain.
 * Ein Name, der nicht eindeutig übereinstimmt, kann nie „sicher“ sein, außer die Domain bestätigt ihn.
 */
export function vergleicheFirmen(a: FirmaMerkmale, b: FirmaMerkmale): MatchErgebnis {
  if (a.registerKey && b.registerKey) {
    const gleich = a.registerKey === b.registerKey;
    return { score: gleich ? 1 : 0, entscheidung: gleich ? 'sicher' : 'getrennt', details: { register: gleich ? 1 : 0 } };
  }
  const domA = normalisiereDomain(a.domain);
  const domB = normalisiereDomain(b.domain);
  const name = namensAehnlichkeit(a.nameNormalized, b.nameNormalized);
  const { score, details } = kombiniere(
    {
      name: { gewicht: 0.5, wert: name },
      strasse: { gewicht: 0.2, wert: vergleiche(a.strasse, b.strasse, (x, y) => jaroWinkler(normalisiereText(x), normalisiereText(y))) },
      plz: { gewicht: 0.15, wert: vergleiche(a.plz, b.plz, (x, y) => (x === y ? 1 : 0)) },
      ort: { gewicht: 0.05, wert: vergleiche(a.ort, b.ort, (x, y) => jaroWinkler(normalisiereText(x), normalisiereText(y))) },
      domain: { gewicht: 0.3, wert: domA && domB ? (domA === domB ? 1 : 0) : null },
    },
    0.7,
  );
  let entscheidung: MatchEntscheidung = score >= SCHWELLEN.firma.sicher ? 'sicher' : score >= SCHWELLEN.firma.unsicher ? 'unsicher' : 'getrennt';
  const domainGleich = !!domA && domA === domB;
  // Gleiche Domain bei ähnlichem Namen bestätigt eine Zuordnung, die sonst knapp unter der Schwelle läge
  if (entscheidung === 'unsicher' && domainGleich && name >= 0.7) entscheidung = 'sicher';
  // Ein Name, der nicht eindeutig übereinstimmt, oder eine andere Straße im selben Ort kann nie automatisch „sicher“ sein (außer die Domain bestätigt es)
  const strasse = details.strasse;
  if (entscheidung === 'sicher' && !domainGleich && (name < 0.85 || (strasse !== null && strasse < 0.85))) entscheidung = 'unsicher';
  return { score, entscheidung, details };
}

export type PersonMerkmale = { vorname: string | null; nachname: string };

/** „nachname|vorname“, normalisiert; Grundlage für Zuordnung und Eindeutigkeit innerhalb einer Firma. */
export function personenSchluessel(p: PersonMerkmale): string {
  return `${normalisiereText(p.nachname)}|${normalisiereText(p.vorname ?? '')}`;
}

/** Personenvergleich innerhalb einer Firma: Nachname und Vorname (auch Initial) gewichtet. */
export function vergleichePersonen(a: PersonMerkmale, b: PersonMerkmale): MatchErgebnis {
  const nachname = jaroWinkler(normalisiereText(a.nachname), normalisiereText(b.nachname));
  const va = normalisiereText(a.vorname ?? '');
  const vb = normalisiereText(b.vorname ?? '');
  let vorname: number | null = null;
  if (va && vb) {
    if (va === vb) vorname = 1;
    // „H.“ gegen „Hans“ oder „Hans“ gegen „Hans Peter“: gleiche Anfangsbuchstaben
    else if (va[0] === vb[0] && (va.length === 1 || vb.length === 1)) vorname = 0.85;
    else if (va.startsWith(vb + ' ') || vb.startsWith(va + ' ')) vorname = 0.9;
    else vorname = jaroWinkler(va, vb) * 0.9;
  }
  const { score, details } = kombiniere({ nachname: { gewicht: 0.6, wert: nachname }, vorname: { gewicht: 0.4, wert: vorname } }, 0.7);
  let entscheidung: MatchEntscheidung = score >= SCHWELLEN.person.sicher ? 'sicher' : score >= SCHWELLEN.person.unsicher ? 'unsicher' : 'getrennt';
  // Verschiedene ausgeschriebene Vornamen („Hans“ / „Hanna“) nie automatisch zusammenführen
  if (entscheidung === 'sicher' && va && vb && va !== vb && va.length > 1 && vb.length > 1 && !va.startsWith(vb + ' ') && !vb.startsWith(va + ' ')) entscheidung = 'unsicher';
  return { score, entscheidung, details };
}
