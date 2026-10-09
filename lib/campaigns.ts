import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { firmenDuplikate, firmenSchluessel } from './firma';
import { deleteMedia } from './media';
import { schliesseKampagneAb, stoppeRender } from './render-queue';
import { normalisiereSpaltenname } from './vorlage';

export const STANDARD_BETREFF = 'Kurzes Video für {{firma}}';
export const STANDARD_TEXT = `{{begruessung}},

ich habe für {{firma}} ein kurzes, persönliches Video aufgenommen:

{{vorschaubild}}

Wenn das für Sie interessant ist, freue ich mich über eine kurze Rückmeldung oder einen 15-Minuten-Termin.`;

export const STANDARD_BETREFF_OHNE_VIDEO = 'Kurze Frage an {{firma}}';
export const STANDARD_TEXT_OHNE_VIDEO = `{{begruessung}},

ich melde mich kurz bei Ihnen, weil …

Wenn das für Sie interessant ist, freue ich mich über eine kurze Rückmeldung oder einen 15-Minuten-Termin.`;

export type FollowupEingabe = { waitDays: number; body: string };

/** Follow-up-Schritte einer Kampagne komplett ersetzen (Reihenfolge = Position). */
export function speichereFollowups(campaignId: number, schritte: FollowupEingabe[]): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.followups).where(eq(schema.followups.campaignId, campaignId)).run();
    schritte.forEach((s, i) => {
      tx.insert(schema.followups).values({ campaignId, position: i + 1, waitDays: s.waitDays, body: s.body }).run();
    });
  });
}

/**
 * Kampagne endgültig löschen: Rendern stoppen, Leads/Events/Follow-ups/Versandprotokoll (Cascade) und
 * die gerenderten Videos + Vorschaubilder entfernen. Sperrliste und Abmeldungen bleiben erhalten.
 */
export function loescheKampagne(campaignId: number): { leads: number } | null {
  const db = getDb();
  const k = db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
  if (!k) return null;
  // Laufenden Render-Job abbrechen lassen, damit er keine Dateien mehr schreibt
  stoppeRender(campaignId);
  const slugs = db.select({ slug: schema.leads.slug }).from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).all();
  db.delete(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).run();
  for (const { slug } of slugs) deleteMedia(slug);
  return { leads: slugs.length };
}

export const FIRMEN_DUPLIKAT = 'Firmen-Duplikat';

/** Reihenfolge, in der je Firma der „behaltene“ Kontakt gewählt wird: bereits angeschriebene zuerst, dann nach Import. */
export function duplikatReihenfolge<T extends { id: number; sendStatus: string }>(leads: T[]): T[] {
  return [...leads].sort((a, b) => (a.sendStatus === 'gesendet' ? 0 : 1) - (b.sendStatus === 'gesendet' ? 0 : 1) || a.id - b.id);
}

/**
 * Weitere Kontakte derselben Firma vom Versand ausschließen (Status „übersprungen“, Grund „Firmen-Duplikat“)
 * und aus der Render-Warteschlange nehmen. Bereits gesendete Leads bleiben unverändert.
 */
export function schliesseFirmenDuplikateAus(campaignId: number): number {
  const db = getDb();
  const leads = db
    .select({ id: schema.leads.id, firma: schema.leads.firma, sendStatus: schema.leads.sendStatus })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, campaignId))
    .all();
  const duplikate = firmenDuplikate(duplikatReihenfolge(leads));
  const ids = leads.filter((l) => duplikate.has(l.id) && ['nicht_gesendet', 'geplant', 'fehler'].includes(l.sendStatus)).map((l) => l.id);
  if (ids.length === 0) return 0;
  db.update(schema.leads)
    .set({ sendStatus: 'uebersprungen', sendError: FIRMEN_DUPLIKAT, renderRequested: false })
    .where(inArray(schema.leads.id, ids))
    .run();
  schliesseKampagneAb(campaignId);
  return ids.length;
}

/** Ausschluss der Firmen-Duplikate aufheben (sie werden wieder normal versendet). */
export function hebeFirmenDuplikateAuf(campaignId: number): number {
  return getDb()
    .update(schema.leads)
    .set({ sendStatus: 'nicht_gesendet', sendError: null })
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.leads.sendStatus, 'uebersprungen'), eq(schema.leads.sendError, FIRMEN_DUPLIKAT)))
    .run().changes;
}

export const KAMPAGNEN_STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf',
  rendert: 'Rendert',
  bereit: 'Bereit',
  versendet_laufend: 'Versand läuft',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen',
};

/**
 * Kontext für die Import-Prüfung. Jede Kampagne steht für sich: Duplikate (E-Mail, Firma) zählen nur innerhalb
 * der Ziel-Kampagne. Nur die Sperrliste (Abmeldungen) gilt kampagnenübergreifend.
 */
export function ladeImportKontext(campaignId: number) {
  const db = getDb();
  const vorhanden = db.select({ email: schema.leads.email, firma: schema.leads.firma }).from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).all();
  const gesperrt = db.select({ email: schema.suppressionList.email }).from(schema.suppressionList).all();
  return {
    existingEmails: new Set(vorhanden.map((r) => r.email.toLowerCase())),
    suppressed: new Set(gesperrt.map((r) => r.email.toLowerCase())),
    existingFirmen: new Set(vorhanden.map((r) => firmenSchluessel(r.firma))),
  };
}

export type KampagnenKennzahlen = {
  id: number;
  leads: number;
  gerendert: number;
  gesendet: number;
  seitenaufrufe: number;
  videostarts: number;
  /** Ø max. Fortschritt in % der Leads mit Play, null wenn keine */
  sehdauer: number | null;
  terminKlicks: number;
  abmeldungen: number;
  antworten: number;
};

/** Kennzahlen je Kampagne (Nicht-Bot-Events) */
export function ladeKennzahlen(): Map<number, KampagnenKennzahlen> {
  const db = getDb();
  const map = new Map<number, KampagnenKennzahlen>();
  const get = (id: number) => {
    let k = map.get(id);
    if (!k) {
      k = { id, leads: 0, gerendert: 0, gesendet: 0, seitenaufrufe: 0, videostarts: 0, sehdauer: null, terminKlicks: 0, abmeldungen: 0, antworten: 0 };
      map.set(id, k);
    }
    return k;
  };

  const leadRows = db
    .select({
      id: schema.leads.campaignId,
      leads: sql<number>`count(*)`,
      gerendert: sql<number>`sum(case when ${schema.leads.renderStatus} = 'fertig' then 1 else 0 end)`,
      gesendet: sql<number>`sum(case when ${schema.leads.sendStatus} = 'gesendet' then 1 else 0 end)`,
      abmeldungen: sql<number>`sum(case when ${schema.leads.unsubscribed} = 1 then 1 else 0 end)`,
      antworten: sql<number>`sum(case when ${schema.leads.flowStopp} = 'beantwortet' then 1 else 0 end)`,
    })
    .from(schema.leads)
    .groupBy(schema.leads.campaignId)
    .all();
  for (const r of leadRows)
    Object.assign(get(r.id), { leads: r.leads, gerendert: r.gerendert ?? 0, gesendet: r.gesendet ?? 0, abmeldungen: r.abmeldungen ?? 0, antworten: r.antworten ?? 0 });

  const eventRows = db
    .select({
      id: schema.leads.campaignId,
      views: sql<number>`sum(case when ${schema.events.type} = 'page_view' then 1 else 0 end)`,
      plays: sql<number>`sum(case when ${schema.events.type} = 'play' then 1 else 0 end)`,
      klicks: sql<number>`sum(case when ${schema.events.type} = 'cta_click' then 1 else 0 end)`,
    })
    .from(schema.events)
    .innerJoin(schema.leads, sql`${schema.events.leadId} = ${schema.leads.id}`)
    .where(sql`${schema.events.isBot} = 0`)
    .groupBy(schema.leads.campaignId)
    .all();
  for (const r of eventRows) Object.assign(get(r.id), { seitenaufrufe: r.views ?? 0, videostarts: r.plays ?? 0, terminKlicks: r.klicks ?? 0 });

  // Ø max. Fortschritt je Lead mit Play
  const sehRows = db
    .select({
      id: schema.leads.campaignId,
      avg: sql<number>`avg(m.max_p)`,
    })
    .from(schema.leads)
    .innerJoin(
      sql`(select lead_id, max(case type when 'progress_100' then 100 when 'progress_75' then 75 when 'progress_50' then 50 when 'progress_25' then 25 else 0 end) as max_p from events where is_bot = 0 group by lead_id having sum(case when type = 'play' then 1 else 0 end) > 0) as m`,
      sql`m.lead_id = ${schema.leads.id}`,
    )
    .groupBy(schema.leads.campaignId)
    .all();
  for (const r of sehRows) get(r.id).sehdauer = r.avg === null ? null : Math.round(r.avg);

  return map;
}

// ---------------------------------------------------------------- Extra-Spalten (Vorlagen-Variablen)

/** Alle normalisierten Extra-Spaltennamen der Leads einer Kampagne (sortiert). */
export function kampagnenExtraSpalten(campaignId: number): string[] {
  const zeilen = getDb().select({ extra: schema.leads.extra }).from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).all();
  const namen = new Set<string>();
  for (const z of zeilen) for (const spalte of Object.keys(z.extra ?? {})) {
    const k = normalisiereSpaltenname(spalte);
    if (k) namen.add(k);
  }
  return [...namen].sort();
}
