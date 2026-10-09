import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { zaehleUngeleseneAntworten } from './lead-status-db';
import { LEAD_STATUS, type LeadStatus } from './lead-status';
import { berlinTeile, startOfDayBerlinMs } from './time';

// Analyse: DB-Abfragen (unten) und reine Aggregations-/Ratenfunktionen (oben, ohne DB testbar)

// ---------------------------------------------------------------- Typen

export type AnalyseLead = {
  id: number;
  mitVideo: boolean;
  sendStatus: string;
  flowStopp: string | null;
  unsubscribed: boolean;
  leadStatus: string;
  /** Unix-ms, null = (noch) keine Antwort erkannt */
  antwortAt: number | null;
  /** Unix-ms des Flow-Stopps (Rückfall für ältere Antworten ohne antwortAt) */
  flowStoppAt: number | null;
  /** Postfach der Erstmail (null/fehlt = Altbestand ohne Zuordnung) */
  absenderId?: number | null;
};

/** Erstes Auftreten eines Event-Typs (ohne Bots) je Lead */
export type ErstesEvent = { leadId: number; type: string; ts: number };

export type VersandZeile = { leadId: number; step: number; sentAt: number; /** Postfach, von dem gesendet wurde */ absenderId?: number | null };

export type TrichterStufe = {
  key: 'leads' | 'gesendet' | 'angesehen' | 'play' | 'p50' | 'p100' | 'termin' | 'antwort';
  label: string;
  anzahl: number;
  /** Anteil an „gesendet“ (bei Video-Stufen: an den gesendeten Leads der Video-Kampagnen); null für „Leads gesamt“ */
  rate: number | null;
  video: boolean;
};

export type Trichter = {
  stufen: TrichterStufe[];
  bounces: number;
  abmeldungen: number;
  bounceRate: number;
  abmeldeRate: number;
  gesendet: number;
  antworten: number;
  /** Gesendete Leads in Video-Kampagnen (Basis der Video-Raten) */
  videoGesendet: number;
  statusVerteilung: { status: LeadStatus; anzahl: number }[];
};

export type SchrittZeile = { step: number; label: string; gesendet: number; antworten: number; antwortRate: number };

/** Gesendet und Antworten je Absender-Postfach (absenderId null = ohne Zuordnung) */
export type PostfachZeile = { absenderId: number | null; gesendet: number; erstmails: number; antworten: number; antwortRate: number };

export type TagesPunkt = { datum: string; gesendet: number; angesehen: number; antworten: number };

export type Rohdaten = {
  leads: AnalyseLead[];
  ereignisse: ErstesEvent[];
  versand: VersandZeile[];
};

// ---------------------------------------------------------------- Reine Funktionen

export const rate = (n: number, von: number) => (von > 0 ? n / von : 0);

/** Antwortzeitpunkt (Unix-ms) eines Leads oder null; Antwort = antwortAt gesetzt oder flowStopp 'beantwortet'. */
export function antwortZeit(l: Pick<AnalyseLead, 'antwortAt' | 'flowStopp' | 'flowStoppAt'>): number | null {
  if (l.antwortAt != null) return l.antwortAt;
  return l.flowStopp === 'beantwortet' ? l.flowStoppAt : null;
}

export function hatGeantwortet(l: Pick<AnalyseLead, 'antwortAt' | 'flowStopp'>): boolean {
  return l.antwortAt != null || l.flowStopp === 'beantwortet';
}

/** Trichter, Bounces, Abmeldungen und Lead-Status-Verteilung. Video-Stufen zählen nur Leads aus Video-Kampagnen. */
export function aggregiereTrichter(leads: AnalyseLead[], ereignisse: ErstesEvent[]): Trichter {
  const typen = new Map<number, Set<string>>();
  for (const e of ereignisse) {
    let s = typen.get(e.leadId);
    if (!s) typen.set(e.leadId, (s = new Set()));
    s.add(e.type);
  }
  const hat = (l: AnalyseLead, ...t: string[]) => {
    const s = typen.get(l.id);
    return !!s && t.some((x) => s.has(x));
  };
  const gesendet = leads.filter((l) => l.sendStatus === 'gesendet');
  const videoLeads = gesendet.filter((l) => l.mitVideo);
  const antworten = gesendet.filter(hatGeantwortet).length;
  const z = (liste: AnalyseLead[], ...t: string[]) => liste.filter((l) => hat(l, ...t)).length;
  const n = gesendet.length;
  const nv = videoLeads.length;
  const stufen: TrichterStufe[] = [
    { key: 'leads', label: 'Leads gesamt', anzahl: leads.length, rate: null, video: false },
    { key: 'gesendet', label: 'Erstmail gesendet', anzahl: n, rate: rate(n, n), video: false },
    { key: 'angesehen', label: 'Video-Seite angesehen', anzahl: z(videoLeads, 'page_view'), rate: rate(z(videoLeads, 'page_view'), nv), video: true },
    { key: 'play', label: 'Video gestartet', anzahl: z(videoLeads, 'play'), rate: rate(z(videoLeads, 'play'), nv), video: true },
    { key: 'p50', label: '50 % angesehen', anzahl: z(videoLeads, 'progress_50', 'progress_75', 'progress_100'), rate: rate(z(videoLeads, 'progress_50', 'progress_75', 'progress_100'), nv), video: true },
    { key: 'p100', label: '100 % angesehen', anzahl: z(videoLeads, 'progress_100'), rate: rate(z(videoLeads, 'progress_100'), nv), video: true },
    { key: 'termin', label: 'Termin-Klick', anzahl: z(videoLeads, 'cta_click'), rate: rate(z(videoLeads, 'cta_click'), nv), video: true },
    { key: 'antwort', label: 'Antwort', anzahl: antworten, rate: rate(antworten, n), video: false },
  ];
  const bounces = gesendet.filter((l) => l.flowStopp === 'bounce').length;
  const abmeldungen = gesendet.filter((l) => l.unsubscribed).length;
  return {
    stufen,
    bounces,
    abmeldungen,
    bounceRate: rate(bounces, n),
    abmeldeRate: rate(abmeldungen, n),
    gesendet: n,
    antworten,
    videoGesendet: nv,
    statusVerteilung: LEAD_STATUS.map((status) => ({ status, anzahl: leads.filter((l) => l.leadStatus === status).length })),
  };
}

export function schrittLabel(step: number): string {
  return step === 0 ? 'Erstmail' : `Follow-up ${step}`;
}

/**
 * Gesendet und Antworten je Schritt. Eine Antwort zählt dem letzten Schritt zu, der vor dem Antwortzeitpunkt
 * gesendet wurde (Rückfall: erster gesendeter Schritt, falls die Antwortzeit vor allen Mails liegt oder fehlt).
 * Schritte ohne Versand erscheinen nicht; `mindestSchritte` füllt Lücken (z. B. konfigurierte Follow-ups) mit 0 auf.
 */
export function aggregiereSchritte(leads: AnalyseLead[], versand: VersandZeile[], mindestSchritte = 1): SchrittZeile[] {
  const proLead = new Map<number, VersandZeile[]>();
  const gesendet = new Map<number, number>();
  for (const v of versand) {
    gesendet.set(v.step, (gesendet.get(v.step) ?? 0) + 1);
    let l = proLead.get(v.leadId);
    if (!l) proLead.set(v.leadId, (l = []));
    l.push(v);
  }
  const antworten = new Map<number, number>();
  for (const lead of leads) {
    if (!hatGeantwortet(lead)) continue;
    const mails = (proLead.get(lead.id) ?? []).slice().sort((a, b) => a.sentAt - b.sentAt || a.step - b.step);
    if (mails.length === 0) continue;
    const zeit = antwortZeit(lead);
    let ziel = mails[0];
    if (zeit != null) for (const m of mails) if (m.sentAt <= zeit) ziel = m;
    antworten.set(ziel.step, (antworten.get(ziel.step) ?? 0) + 1);
  }
  const maxStep = Math.max(mindestSchritte - 1, ...gesendet.keys());
  const zeilen: SchrittZeile[] = [];
  for (let step = 0; step <= maxStep; step++) {
    const g = gesendet.get(step) ?? 0;
    const a = antworten.get(step) ?? 0;
    zeilen.push({ step, label: schrittLabel(step), gesendet: g, antworten: a, antwortRate: rate(a, g) });
  }
  return zeilen;
}

/**
 * Je Postfach: alle gesendeten Mails (inkl. Follow-ups), Erstmails und Antworten auf dessen Erstmails.
 * Die Antwortrate bezieht sich auf die Erstmails. Sortiert nach Postfach-ID, ohne Zuordnung zuletzt.
 */
export function aggregierePostfaecher(leads: AnalyseLead[], versand: VersandZeile[]): PostfachZeile[] {
  const zeilen = new Map<number | null, PostfachZeile>();
  const zeile = (id: number | null | undefined) => {
    const key = id ?? null;
    let z = zeilen.get(key);
    if (!z) zeilen.set(key, (z = { absenderId: key, gesendet: 0, erstmails: 0, antworten: 0, antwortRate: 0 }));
    return z;
  };
  for (const v of versand) {
    const z = zeile(v.absenderId);
    z.gesendet++;
    if (v.step === 0) z.erstmails++;
  }
  for (const l of leads) if (l.sendStatus === 'gesendet' && hatGeantwortet(l)) zeile(l.absenderId).antworten++;
  const liste = [...zeilen.values()];
  for (const z of liste) z.antwortRate = rate(z.antworten, z.erstmails);
  return liste.sort((a, b) => (a.absenderId ?? Infinity) - (b.absenderId ?? Infinity));
}

/** Datum 'YYYY-MM-DD' um `tage` Kalendertage verschieben (ohne Zeitzonen-/Sommerzeitprobleme). */
export function datumPlus(datum: string, tage: number): string {
  const [y, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + tage)).toISOString().slice(0, 10);
}

/** Die letzten `anzahl` Berliner Tage bis einschließlich heute, älteste zuerst. */
export function letzteTage(anzahl: number, jetzt: Date = new Date()): string[] {
  const heute = berlinTeile(jetzt).datum;
  return Array.from({ length: anzahl }, (_, i) => datumPlus(heute, i - (anzahl - 1)));
}

/** Tagesverlauf (Berliner Tage): gesendete Mails, Leads mit erster Video-Ansicht, Antworten. Ereignisse außerhalb der Tage zählen nicht. */
export function aggregiereTage(
  tage: string[],
  quellen: { gesendet: number[]; angesehen: number[]; antworten: number[] },
): TagesPunkt[] {
  const index = new Map(tage.map((t, i) => [t, i]));
  const punkte: TagesPunkt[] = tage.map((datum) => ({ datum, gesendet: 0, angesehen: 0, antworten: 0 }));
  const zaehle = (zeiten: number[], feld: 'gesendet' | 'angesehen' | 'antworten') => {
    for (const ts of zeiten) {
      const i = index.get(berlinTeile(new Date(ts)).datum);
      if (i !== undefined) punkte[i][feld]++;
    }
  };
  zaehle(quellen.gesendet, 'gesendet');
  zaehle(quellen.angesehen, 'angesehen');
  zaehle(quellen.antworten, 'antworten');
  return punkte;
}

/** Tagesverlauf aus Rohdaten. */
export function tagesverlauf(roh: Rohdaten, anzahlTage: number, jetzt: Date = new Date()): TagesPunkt[] {
  const videoIds = new Set(roh.leads.filter((l) => l.mitVideo).map((l) => l.id));
  return aggregiereTage(letzteTage(anzahlTage, jetzt), {
    gesendet: roh.versand.map((v) => v.sentAt),
    angesehen: roh.ereignisse.filter((e) => e.type === 'page_view' && videoIds.has(e.leadId)).map((e) => e.ts),
    antworten: roh.leads.map(antwortZeit).filter((t): t is number => t != null),
  });
}

export type GlobaleKennzahlen = {
  gesendetHeute: number;
  gesendet7Tage: number;
  gesendetGesamt: number;
  /** Erstmails gesendet (Basis der Raten) */
  erstmails: number;
  antworten: number;
  antwortRate: number;
  angesehen: number;
  angesehenRate: number;
  terminKlicks: number;
  terminRate: number;
};

/** Kennzahlen der Startseite aus Rohdaten über alle Kampagnen. */
export function globaleKennzahlen(roh: Rohdaten, jetzt: Date = new Date()): GlobaleKennzahlen {
  const t = aggregiereTrichter(roh.leads, roh.ereignisse);
  const heute = startOfDayBerlinMs(jetzt);
  const vor7 = startOfDayBerlinMs(new Date(heute - 6 * 24 * 3600_000 + 12 * 3600_000));
  const stufe = (key: TrichterStufe['key']) => t.stufen.find((s) => s.key === key)!;
  return {
    gesendetHeute: roh.versand.filter((v) => v.sentAt >= heute).length,
    gesendet7Tage: roh.versand.filter((v) => v.sentAt >= vor7).length,
    gesendetGesamt: roh.versand.length,
    erstmails: t.gesendet,
    antworten: t.antworten,
    antwortRate: rate(t.antworten, t.gesendet),
    angesehen: stufe('angesehen').anzahl,
    angesehenRate: stufe('angesehen').rate ?? 0,
    terminKlicks: stufe('termin').anzahl,
    terminRate: stufe('termin').rate ?? 0,
  };
}

// ---------------------------------------------------------------- DB-Abfragen

const TRICHTER_EVENTS = ['page_view', 'play', 'progress_50', 'progress_75', 'progress_100', 'cta_click'] as const;

/** Lädt die Rohdaten einer Kampagne (oder aller Kampagnen bei `null`) in kompakter Form; Events nur ohne Bots, je Lead und Typ das erste. */
export function ladeRohdaten(campaignId: number | null): Rohdaten {
  const db = getDb();
  const leadRows = db
    .select({
      id: schema.leads.id,
      mitVideo: schema.campaigns.mitVideo,
      sendStatus: schema.leads.sendStatus,
      flowStopp: schema.leads.flowStopp,
      unsubscribed: schema.leads.unsubscribed,
      leadStatus: schema.leads.leadStatus,
      antwortAt: schema.leads.antwortAt,
      flowStoppAt: schema.leads.flowStoppAt,
      absenderId: schema.leads.absenderId,
    })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(campaignId === null ? undefined : eq(schema.leads.campaignId, campaignId))
    .all();
  const leads: AnalyseLead[] = leadRows.map((r) => ({
    ...r,
    antwortAt: r.antwortAt ? r.antwortAt.getTime() : null,
    flowStoppAt: r.flowStoppAt ? r.flowStoppAt.getTime() : null,
  }));

  const ereignisse = db
    .select({
      leadId: schema.events.leadId,
      type: schema.events.type,
      ts: sql<number>`min(${schema.events.createdAt})`,
    })
    .from(schema.events)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.events.leadId))
    .where(and(eq(schema.events.isBot, false), inArray(schema.events.type, [...TRICHTER_EVENTS]), campaignId === null ? undefined : eq(schema.leads.campaignId, campaignId)))
    .groupBy(schema.events.leadId, schema.events.type)
    .all();

  const versand = db
    .select({ leadId: schema.sentMessages.leadId, step: schema.sentMessages.step, sentAt: schema.sentMessages.sentAt, absenderId: schema.sentMessages.absenderId })
    .from(schema.sentMessages)
    .where(campaignId === null ? undefined : eq(schema.sentMessages.campaignId, campaignId))
    .all()
    .map((r) => ({ leadId: r.leadId, step: r.step, sentAt: r.sentAt.getTime(), absenderId: r.absenderId }));

  return { leads, ereignisse, versand };
}

export type KampagnenAnalyse = {
  trichter: Trichter;
  schritte: SchrittZeile[];
  tage: TagesPunkt[];
  postfaecher: (PostfachZeile & { email: string | null })[];
};

/** Komplette Analyse einer Kampagne (Trichter, Schritte, 30-Tage-Verlauf). */
export function ladeKampagnenAnalyse(campaignId: number, mindestSchritte = 1, jetzt: Date = new Date()): KampagnenAnalyse {
  const roh = ladeRohdaten(campaignId);
  const emails = new Map(getDb().select({ id: schema.absender.id, email: schema.absender.email }).from(schema.absender).all().map((a) => [a.id, a.email]));
  return {
    trichter: aggregiereTrichter(roh.leads, roh.ereignisse),
    schritte: aggregiereSchritte(roh.leads, roh.versand, mindestSchritte),
    tage: tagesverlauf(roh, 30, jetzt),
    postfaecher: aggregierePostfaecher(roh.leads, roh.versand).map((z) => ({ ...z, email: z.absenderId !== null ? (emails.get(z.absenderId) ?? null) : null })),
  };
}

export type Uebersicht = { kennzahlen: GlobaleKennzahlen; tage: TagesPunkt[]; ungelesen: number };

/** Kennzahlen der Startseite über alle Kampagnen. */
export function ladeUebersicht(jetzt: Date = new Date()): Uebersicht {
  const roh = ladeRohdaten(null);
  return { kennzahlen: globaleKennzahlen(roh, jetzt), tage: tagesverlauf(roh, 14, jetzt), ungelesen: zaehleUngeleseneAntworten() };
}
