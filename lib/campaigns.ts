import { sql } from 'drizzle-orm';
import { getDb, schema } from './db';

export const STANDARD_BETREFF = 'Kurzes Video für {{firma}}';
export const STANDARD_TEXT = `{{begruessung}},

ich habe für {{firma}} ein kurzes, persönliches Video aufgenommen:

{{vorschaubild}}

Wenn das für Sie interessant ist, freue ich mich über eine kurze Rückmeldung oder einen 15-Minuten-Termin.`;

export const KAMPAGNEN_STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf',
  rendert: 'Rendert',
  bereit: 'Bereit',
  versendet_laufend: 'Versand läuft',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen',
};

/** E-Mails aller Leads (kampagnenübergreifend) und der Sperrliste für die Import-Validierung */
export function ladeImportKontext() {
  const db = getDb();
  const vorhanden = db.select({ email: schema.leads.email }).from(schema.leads).all();
  const gesperrt = db.select({ email: schema.suppressionList.email }).from(schema.suppressionList).all();
  return {
    existingEmails: new Set(vorhanden.map((r) => r.email.toLowerCase())),
    suppressed: new Set(gesperrt.map((r) => r.email.toLowerCase())),
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
};

/** Kennzahlen je Kampagne (Nicht-Bot-Events) */
export function ladeKennzahlen(): Map<number, KampagnenKennzahlen> {
  const db = getDb();
  const map = new Map<number, KampagnenKennzahlen>();
  const get = (id: number) => {
    let k = map.get(id);
    if (!k) {
      k = { id, leads: 0, gerendert: 0, gesendet: 0, seitenaufrufe: 0, videostarts: 0, sehdauer: null, terminKlicks: 0, abmeldungen: 0 };
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
    })
    .from(schema.leads)
    .groupBy(schema.leads.campaignId)
    .all();
  for (const r of leadRows) Object.assign(get(r.id), { leads: r.leads, gerendert: r.gerendert ?? 0, gesendet: r.gesendet ?? 0, abmeldungen: r.abmeldungen ?? 0 });

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
