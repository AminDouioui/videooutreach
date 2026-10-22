import { GENERISCHE_POSTFAECHER } from '../config';
import { namensVarianten, type NamensVarianten } from './namen';

// Schritt B und C der Kontakt-Engine: E-Mail-Muster einer Domain aus bekannten Adressen rückwärts ableiten, Muster-Konfidenz nach
// Anzahl der Belege, Kandidaten-Adressen aus Name und Mustern bilden.

type Bau = (v: string, i: string, n: string) => string;

/** Gängige Muster; `prior` ist die Standardwahrscheinlichkeit, wenn nichts über die Domain bekannt ist. */
export const MUSTER: Array<{ key: string; prior: number; bau: Bau; braucht: 'v' | 'i' | 'vi' | '' }> = [
  { key: 'vorname.nachname', prior: 0.38, bau: (v, _i, n) => `${v}.${n}`, braucht: 'v' },
  { key: 'v.nachname', prior: 0.12, bau: (_v, i, n) => `${i}.${n}`, braucht: 'i' },
  { key: 'vnachname', prior: 0.08, bau: (_v, i, n) => `${i}${n}`, braucht: 'i' },
  { key: 'vornamenachname', prior: 0.08, bau: (v, _i, n) => `${v}${n}`, braucht: 'v' },
  { key: 'nachname', prior: 0.08, bau: (_v, _i, n) => n, braucht: '' },
  { key: 'vorname', prior: 0.06, bau: (v) => v, braucht: 'v' },
  { key: 'vorname_nachname', prior: 0.03, bau: (v, _i, n) => `${v}_${n}`, braucht: 'v' },
  { key: 'vorname-nachname', prior: 0.02, bau: (v, _i, n) => `${v}-${n}`, braucht: 'v' },
  { key: 'nachname.vorname', prior: 0.04, bau: (v, _i, n) => `${n}.${v}`, braucht: 'v' },
  { key: 'nachname_vorname', prior: 0.02, bau: (v, _i, n) => `${n}_${v}`, braucht: 'v' },
  { key: 'nachnamev', prior: 0.03, bau: (_v, i, n) => `${n}${i}`, braucht: 'i' },
  { key: 'nachname.v', prior: 0.02, bau: (_v, i, n) => `${n}.${i}`, braucht: 'i' },
];

/** Gewicht des Standard-Priors beim Mischen mit Belegen (entspricht „einem gedachten Beleg“) */
const PRIOR_GEWICHT = 1;

export type MusterKonfidenz = { muster: string; konfidenz: number; belege: number };

export function istGenerischesPostfach(local: string): boolean {
  return GENERISCHE_POSTFAECHER.includes(local.toLowerCase().split('+')[0]);
}

export function zerlegeAdresse(adresse: string): { local: string; domain: string } | null {
  const m = /^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/i.exec(adresse.trim());
  return m ? { local: m[1].toLowerCase(), domain: m[2].toLowerCase() } : null;
}

/** Lokalteile (alle Varianten) pro Muster für eine Person; Duplikate bleiben der ersten Variante zugeordnet. */
export function lokalteile(muster: (typeof MUSTER)[number], v: NamensVarianten): string[] {
  const aus: string[] = [];
  const vornamen = muster.braucht.includes('v') ? v.vornamen : [''];
  const initialen = muster.braucht.includes('i') ? v.initialen : [''];
  for (const n of v.nachnamen) for (const vn of vornamen) for (const i of initialen) {
    if (muster.braucht.includes('v') && !vn) continue;
    if (muster.braucht.includes('i') && !i) continue;
    aus.push(muster.bau(vn, i, n));
  }
  return [...new Set(aus)];
}

/**
 * Welche Muster erklären diese Adresse für diese Person? Mehrere Treffer sind möglich (z. B. „mueller“ bei Doppelnamen);
 * Adressen mit „+tag“ werden ohne Tag verglichen. Leere Liste = Adresse gehört nicht zum Namen oder ist generisch.
 */
export function leiteMusterAb(adresse: string, person: { vorname: string | null; nachname: string }): string[] {
  const z = zerlegeAdresse(adresse);
  if (!z || istGenerischesPostfach(z.local)) return [];
  const local = z.local.split('+')[0];
  const v = namensVarianten(person);
  return MUSTER.filter((m) => lokalteile(m, v).includes(local)).map((m) => m.key);
}

/**
 * Konfidenz je Muster: Mischung aus beobachteten Belegen und Standard-Prior, (belege + α·prior) / (gesamt + α).
 * Ohne Belege ist das der Prior; je mehr Adressen dasselbe Muster zeigen, desto sicherer. Sortiert absteigend.
 */
export function musterKonfidenzen(belege: ReadonlyMap<string, number>): MusterKonfidenz[] {
  const gesamt = [...belege.values()].reduce((s, n) => s + n, 0);
  const priorSumme = MUSTER.reduce((s, m) => s + m.prior, 0);
  return MUSTER.map((m) => {
    const n = belege.get(m.key) ?? 0;
    return { muster: m.key, belege: n, konfidenz: (n + (PRIOR_GEWICHT * m.prior) / priorSumme) / (gesamt + PRIOR_GEWICHT) };
  }).sort((a, b) => b.konfidenz - a.konfidenz || MUSTER.findIndex((m) => m.key === a.muster) - MUSTER.findIndex((m) => m.key === b.muster));
}

/** Sammelt Belege: jede Adresse mit zugehörigem Namen zählt für ihre passenden Muster (bei mehreren Treffern anteilig). */
export function zaehleBelege(paare: Array<{ adresse: string; person: { vorname: string | null; nachname: string } }>): Map<string, number> {
  const belege = new Map<string, number>();
  const gesehen = new Set<string>();
  for (const { adresse, person } of paare) {
    const key = adresse.toLowerCase();
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    const treffer = leiteMusterAb(adresse, person);
    for (const t of treffer) belege.set(t, (belege.get(t) ?? 0) + 1 / treffer.length);
  }
  return belege;
}

export type AdressKandidat = { adresse: string; muster: string; konfidenz: number; variante: number };

/**
 * Setzt den Namen in alle Muster ein. Die Konfidenz ist die Muster-Konfidenz, gedämpft für weniger wahrscheinliche Namensvarianten
 * (zweite Umlaut-Schreibweise, Teilnamen bei Doppelnamen). Sortiert nach Konfidenz, höchstens `max` Kandidaten.
 */
export function bildeKandidaten(person: { vorname: string | null; nachname: string }, domain: string, muster: MusterKonfidenz[], max = 40): AdressKandidat[] {
  const v = namensVarianten(person);
  const aus: AdressKandidat[] = [];
  const gesehen = new Set<string>();
  for (const mk of muster) {
    const def = MUSTER.find((m) => m.key === mk.muster);
    if (!def) continue;
    lokalteile(def, v).forEach((local, idx) => {
      const adresse = `${local}@${domain.toLowerCase()}`;
      if (gesehen.has(adresse)) return;
      gesehen.add(adresse);
      aus.push({ adresse, muster: mk.muster, konfidenz: mk.konfidenz * Math.max(0.2, 1 - idx * 0.2), variante: idx });
    });
  }
  return aus.sort((a, b) => b.konfidenz - a.konfidenz).slice(0, max);
}
