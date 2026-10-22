import { DATEN_SCORE_GEWICHTE, EMAIL_STATUS_WERT, ICP_UNBEKANNT, STANDARD_ICP, type IcpKonfig } from './config';
import { mitDecay } from './golden/survivorship';

// Stufe 8: Scoring. Datenqualitäts-Score (Vollständigkeit, Konfidenz, E-Mail-Status, Aktualität) und ICP-Fit (Branche, Mitarbeiterklasse,
// Region, Rechtsform) mit konfigurierbaren Gewichten. Beides sind reine Funktionen auf dem Golden Record, jederzeit neu berechenbar
// (die UI rechnet den ICP-Fit mit dem Filter des Nutzers neu).

export type FeldHerkunft = { konfidenz: number; beobachtetAm: number };

export type GoldenFirma = {
  name: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  bundesland: string | null;
  rechtsform: string | null;
  domain: string | null;
  branche: string | null;
  brancheKonfidenz: number | null;
  mitarbeiterZahl: number | null;
  mitarbeiterTyp: 'exakt' | 'klasse' | 'schaetzung' | null;
  mitarbeiterKlasse: string | null;
  /** Herkunft je Feld (Konfidenz nach Decay und Zeitpunkt der Beobachtung) */
  herkunft: Record<string, FeldHerkunft | undefined>;
  /** Ansprechpartner in der Zielrolle (oder deren Fallback) */
  person: { konfidenz: number; beobachtetAm: number } | null;
  email: { status: string; konfidenz: number; verifiziertAm: number | null } | null;
  telefon: boolean;
};

const runde = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);

// ---------------------------------------------------------------- Datenqualität

/** Wie viel zählt welche Angabe für die Vollständigkeit (Summe 1) */
const VOLLSTAENDIGKEIT = { name: 0.1, adresse: 0.15, domain: 0.15, branche: 0.1, mitarbeiter: 0.1, person: 0.2, email: 0.15, telefon: 0.05 } as const;

export type DatenScore = { score: number; vollstaendigkeit: number; konfidenz: number; email: number; aktualitaet: number; fehlend: string[] };

export function berechneDatenScore(g: GoldenFirma, jetzt: number, gewichte: typeof DATEN_SCORE_GEWICHTE = DATEN_SCORE_GEWICHTE): DatenScore {
  const hat: Record<keyof typeof VOLLSTAENDIGKEIT, number> = {
    name: g.name ? 1 : 0,
    adresse: [g.strasse, g.plz, g.ort].filter(Boolean).length / 3,
    domain: g.domain ? 1 : 0,
    branche: g.branche ? 1 : 0,
    mitarbeiter: g.mitarbeiterZahl !== null || g.mitarbeiterKlasse ? 1 : 0,
    person: g.person ? 1 : 0,
    email: g.email ? 1 : 0,
    telefon: g.telefon ? 1 : 0,
  };
  const vollstaendigkeit = (Object.keys(VOLLSTAENDIGKEIT) as Array<keyof typeof VOLLSTAENDIGKEIT>).reduce((s, k) => s + VOLLSTAENDIGKEIT[k] * hat[k], 0);
  const fehlend = (Object.keys(hat) as Array<keyof typeof hat>).filter((k) => hat[k] < 1);

  // Konfidenz und Aktualität: Mittel über die vorhandenen Schlüsselfelder
  const konfidenzen: number[] = [];
  const frische: number[] = [];
  for (const [feld, h] of Object.entries(g.herkunft)) {
    if (!h) continue;
    konfidenzen.push(h.konfidenz);
    frische.push(mitDecay(1, feld, h.beobachtetAm, jetzt));
  }
  if (g.person) {
    konfidenzen.push(g.person.konfidenz);
    frische.push(mitDecay(1, 'person', g.person.beobachtetAm, jetzt));
  }
  if (g.email) {
    konfidenzen.push(g.email.konfidenz);
    frische.push(g.email.verifiziertAm ? mitDecay(1, 'email', g.email.verifiziertAm, jetzt) : 0.3);
  }
  const mittel = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const konfidenz = mittel(konfidenzen);
  const email = g.email ? (EMAIL_STATUS_WERT[g.email.status] ?? 0) : 0;
  const aktualitaet = mittel(frische);
  const summe = gewichte.vollstaendigkeit + gewichte.konfidenz + gewichte.email + gewichte.aktualitaet;
  const score = (gewichte.vollstaendigkeit * vollstaendigkeit + gewichte.konfidenz * konfidenz + gewichte.email * email + gewichte.aktualitaet * aktualitaet) / summe;
  return { score: runde(score), vollstaendigkeit: runde(vollstaendigkeit), konfidenz: runde(konfidenz), email: runde(email), aktualitaet: runde(aktualitaet), fehlend };
}

// ---------------------------------------------------------------- ICP-Fit

/** Wertebereich (Mitarbeiter) je Größenklasse; die HGB-Klassen nach § 267 gelten nur für das Merkmal Arbeitnehmerzahl */
const KLASSEN_INTERVALL: Record<string, [number, number]> = {
  '<50': [0, 49], '50-99': [50, 99], '100-249': [100, 249], '250-499': [250, 499], '500-800': [500, 800], '>800': [801, 5000],
  hgb_klein: [0, 50], hgb_mittel: [51, 250], hgb_gross: [251, 5000],
};

export function klassenUeberlappung(klasse: string, min: number, max: number): number | null {
  const i = KLASSEN_INTERVALL[klasse];
  if (!i) return null;
  const ueberlapp = Math.min(i[1], max) - Math.max(i[0], min) + 1;
  return Math.max(0, ueberlapp) / (i[1] - i[0] + 1);
}

/** Mischt eine Passung mit „unbekannt“: je unsicherer die Angabe, desto näher am neutralen Wert */
const mischeMitUnbekannt = (wert: number, sicherheit: number) => wert * sicherheit + ICP_UNBEKANNT * (1 - sicherheit);

const MA_SICHERHEIT = { exakt: 1, klasse: 0.9, schaetzung: 0.75 } as const;

export type IcpScore = { score: number; branche: number; mitarbeiter: number; region: number; rechtsform: number };

export function berechneIcpScore(g: GoldenFirma, icp: IcpKonfig = STANDARD_ICP): IcpScore {
  const branche = g.branche ? mischeMitUnbekannt(icp.branchen[g.branche] ?? 0, Math.max(0, Math.min(1, g.brancheKonfidenz ?? 0.5))) : ICP_UNBEKANNT;

  let mitarbeiter = ICP_UNBEKANNT;
  if (g.mitarbeiterZahl !== null) {
    const z = g.mitarbeiterZahl;
    const roh = z >= icp.mitarbeiterMin && z <= icp.mitarbeiterMax ? 1 : z < icp.mitarbeiterMin ? 0.6 * (z / icp.mitarbeiterMin) : 0.6 * (icp.mitarbeiterMax / z);
    mitarbeiter = mischeMitUnbekannt(roh, MA_SICHERHEIT[g.mitarbeiterTyp ?? 'schaetzung']);
  } else if (g.mitarbeiterKlasse) {
    const u = klassenUeberlappung(g.mitarbeiterKlasse, icp.mitarbeiterMin, icp.mitarbeiterMax);
    if (u !== null) mitarbeiter = mischeMitUnbekannt(u, MA_SICHERHEIT.klasse);
  }

  const hatRegionsFilter = icp.bundeslaender.length > 0 || icp.plzPraefixe.length > 0;
  let region = 1;
  if (hatRegionsFilter) {
    if (!g.bundesland && !g.plz) region = ICP_UNBEKANNT;
    else region = (g.bundesland && icp.bundeslaender.includes(g.bundesland)) || (g.plz && icp.plzPraefixe.some((p) => g.plz!.startsWith(p))) ? 1 : 0;
  }

  const rechtsform = g.rechtsform ? (icp.rechtsformen[g.rechtsform] ?? icp.rechtsformStandard) : ICP_UNBEKANNT;

  const w = icp.gewichte;
  const summe = w.branche + w.mitarbeiter + w.region + w.rechtsform;
  const score = (w.branche * branche + w.mitarbeiter * mitarbeiter + w.region * region + w.rechtsform * rechtsform) / summe;
  return { score: runde(score), branche: runde(branche), mitarbeiter: runde(mitarbeiter), region: runde(region), rechtsform: runde(rechtsform) };
}
