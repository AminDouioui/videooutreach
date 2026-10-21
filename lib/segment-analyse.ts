import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import { EINWAND_LABEL, istEinwand, type Einwand } from './einwaende';
import { ctaOrtAusMeta, type CtaOrt } from './video-cta';
import { normalisiereSpaltenname } from './vorlage';

// Auswertung nach Segment (Rolle, Position, eigene Importspalten wie Branche oder Firmengröße) und Einwand-Verteilung.
// Reine Aggregation oben (ohne DB testbar), Abfragen unten. Bots zählen nirgends.

export type SegmentLead = {
  id: number;
  position: string | null;
  extra: Record<string, unknown> | null;
  gesendet: boolean;
  antwort: boolean;
  leadStatus: string;
  angesehen: boolean;
  play: boolean;
  termin: boolean;
};

export type SegmentZeile = { segment: string; leads: number; gesendet: number; angesehen: number; play: number; termin: number; antworten: number; positiv: number; antwortRate: number | null; positivRate: number | null };

/** Status, die als positives Ergebnis gelten */
const POSITIV = new Set(['interessiert', 'termin_gebucht', 'gewonnen']);

const ROLLEN: [string, RegExp][] = [
  ['Geschäftsführung', /gesch[aä]ftsf[uü]hr|inhaber|gesellschafter|ceo|managing|vorstand|gf\b/i],
  ['Einkauf', /einkauf|beschaffung|procurement|purchas/i],
  ['Vertrieb', /vertrieb|sales|verkauf|key account|kundenbetreuung/i],
  ['Produktion und Technik', /produktion|fertigung|arbeitsvorbereitung|\bav\b|technische|betriebsleit|instandhaltung|konstruktion|entwicklung|engineering/i],
  ['Qualität und Logistik', /qualit[aä]t|logistik|lager|supply/i],
  ['Finanzen und Verwaltung', /buchhaltung|finanz|controlling|rechnungswesen|verwaltung|kaufm[aä]nn/i],
  ['IT und Digitalisierung', /\bit\b|edv|digital|informatik|systemadmin/i],
  ['Personal', /personal|hr\b|human resources/i],
];

/** Ordnet eine Position einer groben Rolle zu ("Leiter Einkauf" → "Einkauf"); leer = "Unbekannt", sonst "Sonstige". */
export function rolleAusPosition(position: string | null | undefined): string {
  const p = (position ?? '').trim();
  if (!p) return 'Unbekannt';
  return ROLLEN.find(([, re]) => re.test(p))?.[0] ?? 'Sonstige';
}

export const MAX_SEGMENTE = 15;

/** Wert eines Segment-Feldes: "rolle", "position" oder der Name einer eigenen Importspalte (normalisiert). */
export function segmentWert(l: Pick<SegmentLead, 'position' | 'extra'>, feld: string): string {
  if (feld === 'rolle') return rolleAusPosition(l.position);
  if (feld === 'position') return (l.position ?? '').trim() || 'Unbekannt';
  for (const [k, v] of Object.entries(l.extra ?? {})) {
    if (normalisiereSpaltenname(k) === feld) {
      const t = String(v ?? '').trim();
      return t ? t.slice(0, 60) : 'Unbekannt';
    }
  }
  return 'Unbekannt';
}

const rate = (n: number, von: number) => (von > 0 ? n / von : null);

/** Gruppiert nach Feld; die größten MAX_SEGMENTE bleiben, der Rest wird "Weitere". Sortiert nach Zahl der gesendeten Mails. */
export function gruppiereNachSegment(leads: SegmentLead[], feld: string): SegmentZeile[] {
  const map = new Map<string, SegmentZeile>();
  for (const l of leads) {
    const s = segmentWert(l, feld);
    const z = map.get(s) ?? { segment: s, leads: 0, gesendet: 0, angesehen: 0, play: 0, termin: 0, antworten: 0, positiv: 0, antwortRate: null, positivRate: null };
    z.leads++;
    if (l.gesendet) {
      z.gesendet++;
      if (l.angesehen) z.angesehen++;
      if (l.play) z.play++;
      if (l.termin) z.termin++;
      if (l.antwort) z.antworten++;
      if (POSITIV.has(l.leadStatus)) z.positiv++;
    }
    map.set(s, z);
  }
  const sortiert = [...map.values()].sort((a, b) => b.gesendet - a.gesendet || b.leads - a.leads || a.segment.localeCompare(b.segment, 'de'));
  let zeilen = sortiert;
  if (sortiert.length > MAX_SEGMENTE) {
    const rest = sortiert.slice(MAX_SEGMENTE - 1).reduce<SegmentZeile>(
      (a, z) => ({ ...a, leads: a.leads + z.leads, gesendet: a.gesendet + z.gesendet, angesehen: a.angesehen + z.angesehen, play: a.play + z.play, termin: a.termin + z.termin, antworten: a.antworten + z.antworten, positiv: a.positiv + z.positiv }),
      { segment: 'Weitere', leads: 0, gesendet: 0, angesehen: 0, play: 0, termin: 0, antworten: 0, positiv: 0, antwortRate: null, positivRate: null },
    );
    zeilen = [...sortiert.slice(0, MAX_SEGMENTE - 1), rest];
  }
  return zeilen.map((z) => ({ ...z, antwortRate: rate(z.antworten, z.gesendet), positivRate: rate(z.positiv, z.gesendet) }));
}

export function ladeSegmentLeads(campaignId: number): SegmentLead[] {
  const db = getDb();
  const leads = db
    .select({ id: schema.leads.id, position: schema.leads.position, extra: schema.leads.extra, sendStatus: schema.leads.sendStatus, flowStopp: schema.leads.flowStopp, leadStatus: schema.leads.leadStatus })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, campaignId))
    .all();
  const ids = leads.map((l) => l.id);
  const hat = new Map<string, Set<number>>();
  // Events in Stücken, damit die IN-Liste klein bleibt
  for (let i = 0; i < ids.length; i += 500) {
    const rows = db
      .select({ leadId: schema.events.leadId, type: schema.events.type })
      .from(schema.events)
      .where(and(inArray(schema.events.leadId, ids.slice(i, i + 500)), eq(schema.events.isBot, false), inArray(schema.events.type, ['page_view', 'play', 'cta_click'])))
      .all();
    for (const r of rows) (hat.get(r.type) ?? hat.set(r.type, new Set()).get(r.type)!).add(r.leadId);
  }
  return leads.map((l) => ({
    id: l.id,
    position: l.position,
    extra: l.extra as Record<string, unknown> | null,
    gesendet: l.sendStatus === 'gesendet',
    antwort: l.flowStopp === 'beantwortet',
    leadStatus: l.leadStatus,
    angesehen: hat.get('page_view')?.has(l.id) ?? false,
    play: hat.get('play')?.has(l.id) ?? false,
    termin: hat.get('cta_click')?.has(l.id) ?? false,
  }));
}

/** Felder, nach denen sich auswerten lässt: Rolle, Position und die eigenen Importspalten der Kampagne */
export function segmentFelder(extraSpalten: string[]): { key: string; label: string }[] {
  return [{ key: 'rolle', label: 'Rolle' }, { key: 'position', label: 'Position' }, ...extraSpalten.map((s) => ({ key: s, label: s }))];
}

export type EinwandZeile = { einwand: Einwand; label: string; anzahl: number };

/** Verteilung der erkannten Einwände (ohne "kein Einwand"), häufigste zuerst */
export function ladeEinwandVerteilung(campaignId: number): EinwandZeile[] {
  const rows = getDb().select({ e: schema.leads.kiEinwand }).from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).all();
  const zaehler = new Map<Einwand, number>();
  for (const r of rows) if (istEinwand(r.e) && r.e !== 'kein_einwand') zaehler.set(r.e, (zaehler.get(r.e) ?? 0) + 1);
  return [...zaehler.entries()].map(([einwand, anzahl]) => ({ einwand, label: EINWAND_LABEL[einwand], anzahl })).sort((a, b) => b.anzahl - a.anzahl);
}

/** Termin-Klicks (ohne Bots) nach Platzierung: unter dem Video oder im ab 50 % eingeblendeten zweiten Button */
export function ladeCtaOrte(campaignId: number): Record<CtaOrt, number> {
  const rows = getDb()
    .select({ meta: schema.events.meta })
    .from(schema.events)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.events.leadId))
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.events.type, 'cta_click'), eq(schema.events.isBot, false)))
    .all();
  const aus: Record<CtaOrt, number> = { unten: 0, video_50: 0 };
  for (const r of rows) aus[ctaOrtAusMeta(r.meta)]++;
  return aus;
}
