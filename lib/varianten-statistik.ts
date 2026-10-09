import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { ladeLeadMetriken, type LeadMetriken } from './tracking';
import { STANDARD_VARIANTE } from './varianten';
import { ladeVarianten } from './varianten-db';

export type VariantenStatistik = {
  kuerzel: string;
  aktiv: boolean;
  gesendet: number;
  /** Leads mit mindestens einem Seitenaufruf der Video-Seite (keine Bots) */
  angesehen: number;
  play: number;
  terminKlick: number;
  /** Leads, die geantwortet haben (flowStopp = 'beantwortet') */
  antworten: number;
  /** Raten bezogen auf „gesendet“ (0–1; 0 ohne Versand) */
  angesehenRate: number;
  playRate: number;
  terminRate: number;
  antwortRate: number;
};

type LeadKurz = { id: number; variante: string | null; sendStatus: string; flowStopp: string | null };

const rate = (n: number, von: number) => (von > 0 ? n / von : 0);

/** Reine Aggregation: je Variante (in der Reihenfolge von `varianten`) Zähler und Raten. Ältere Leads ohne Kürzel zählen als A. */
export function aggregiereVarianten(varianten: { kuerzel: string; aktiv: boolean }[], leads: LeadKurz[], metriken: Map<number, LeadMetriken>): VariantenStatistik[] {
  return varianten.map((v) => {
    const gesendet = leads.filter((l) => l.sendStatus === 'gesendet' && (l.variante ?? STANDARD_VARIANTE) === v.kuerzel);
    const zaehle = (f: (m: LeadMetriken | undefined, l: LeadKurz) => boolean) => gesendet.filter((l) => f(metriken.get(l.id), l)).length;
    const angesehen = zaehle((m) => (m?.aufrufe ?? 0) > 0);
    const play = zaehle((m) => (m?.videostarts ?? 0) > 0);
    const terminKlick = zaehle((m) => (m?.terminKlicks ?? 0) > 0);
    const antworten = zaehle((_, l) => l.flowStopp === 'beantwortet');
    const n = gesendet.length;
    return {
      kuerzel: v.kuerzel,
      aktiv: v.aktiv,
      gesendet: n,
      angesehen,
      play,
      terminKlick,
      antworten,
      angesehenRate: rate(angesehen, n),
      playRate: rate(play, n),
      terminRate: rate(terminKlick, n),
      antwortRate: rate(antworten, n),
    };
  });
}

/** Statistik je Variante (A zuerst, dann B, C …) einer Kampagne; Grundlage der Tabelle und der späteren Analyse-Seite. */
export function ladeVariantenStatistik(campaignId: number): VariantenStatistik[] {
  const zusatz = ladeVarianten(campaignId);
  const leads = getDb()
    .select({ id: schema.leads.id, variante: schema.leads.variante, sendStatus: schema.leads.sendStatus, flowStopp: schema.leads.flowStopp })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, campaignId))
    .all();
  return aggregiereVarianten([{ kuerzel: STANDARD_VARIANTE, aktiv: true }, ...zusatz.map((v) => ({ kuerzel: v.kuerzel, aktiv: v.aktiv }))], leads, ladeLeadMetriken(campaignId));
}
