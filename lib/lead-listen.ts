import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from './db';
import { istLeadStatus } from './lead-status';

// Kampagnenübergreifende Abfragen: Antworten-Postfach und Leads-Seite

export const LEADS_PRO_SEITE = 100;
export const SEND_STATUS_WERTE = ['nicht_gesendet', 'geplant', 'gesendet', 'fehler', 'uebersprungen'] as const;

type SearchParams = Record<string, string | string[] | undefined>;
const erster = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** LIKE-Muster mit maskierten Sonderzeichen */
function likeMuster(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

// ---------------------------------------------------------------- Antworten-Postfach

export type AntwortFilter = { gelesen: 'ungelesen' | 'alle'; leadStatus: string };

export function parseAntwortFilter(sp: SearchParams): AntwortFilter {
  const status = erster(sp.status);
  return { gelesen: erster(sp.gelesen) === 'alle' ? 'alle' : 'ungelesen', leadStatus: istLeadStatus(status) ? status : '' };
}

export function ladeAntworten(filter: AntwortFilter, limit = 300) {
  const bed: SQL[] = [eq(schema.leads.flowStopp, 'beantwortet')];
  if (filter.gelesen === 'ungelesen') bed.push(eq(schema.leads.antwortGelesen, false));
  if (filter.leadStatus && istLeadStatus(filter.leadStatus)) bed.push(eq(schema.leads.leadStatus, filter.leadStatus));
  return getDb()
    .select({ lead: schema.leads, kampagne: schema.campaigns.name })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(and(...bed))
    .orderBy(desc(sql`coalesce(${schema.leads.antwortAt}, ${schema.leads.flowStoppAt}, 0)`), desc(schema.leads.id))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------- Leads-Seite

export type LeadsFilter = {
  q: string;
  kampagne: number | null;
  leadStatus: string;
  sendStatus: string;
  beantwortet: '' | 'ja' | 'nein';
  sort: 'score' | 'importiert' | 'gesendet';
  dir: 'asc' | 'desc';
  seite: number;
};

export function parseLeadsFilter(sp: SearchParams): LeadsFilter {
  const kampagne = Number(erster(sp.kampagne));
  const leadStatus = erster(sp.status);
  const sendStatus = erster(sp.versand);
  const beantwortet = erster(sp.beantwortet);
  const sort = erster(sp.sort);
  const seite = Math.floor(Number(erster(sp.seite)));
  return {
    q: erster(sp.q).trim().slice(0, 200),
    kampagne: Number.isInteger(kampagne) && kampagne > 0 ? kampagne : null,
    leadStatus: istLeadStatus(leadStatus) ? leadStatus : '',
    sendStatus: (SEND_STATUS_WERTE as readonly string[]).includes(sendStatus) ? sendStatus : '',
    beantwortet: beantwortet === 'ja' || beantwortet === 'nein' ? beantwortet : '',
    sort: sort === 'importiert' || sort === 'gesendet' ? sort : 'score',
    dir: erster(sp.dir) === 'asc' ? 'asc' : 'desc',
    seite: Number.isFinite(seite) && seite > 0 ? seite : 1,
  };
}

export function ladeLeadsSeite(f: LeadsFilter, proSeite = LEADS_PRO_SEITE) {
  const bed: SQL[] = [];
  if (f.q) {
    const m = likeMuster(f.q.toLowerCase());
    bed.push(
      or(
        sql`lower(${schema.leads.firma}) like ${m} escape '\\'`,
        sql`lower(coalesce(${schema.leads.vorname}, '') || ' ' || coalesce(${schema.leads.nachname}, '')) like ${m} escape '\\'`,
        sql`lower(${schema.leads.email}) like ${m} escape '\\'`,
      )!,
    );
  }
  if (f.kampagne !== null) bed.push(eq(schema.leads.campaignId, f.kampagne));
  if (f.leadStatus && istLeadStatus(f.leadStatus)) bed.push(eq(schema.leads.leadStatus, f.leadStatus));
  if (f.sendStatus) bed.push(eq(schema.leads.sendStatus, f.sendStatus as (typeof SEND_STATUS_WERTE)[number]));
  if (f.beantwortet === 'ja') bed.push(eq(schema.leads.flowStopp, 'beantwortet'));
  if (f.beantwortet === 'nein') bed.push(or(isNull(schema.leads.flowStopp), sql`${schema.leads.flowStopp} <> 'beantwortet'`)!);
  const where = bed.length ? and(...bed) : undefined;

  const db = getDb();
  const total = db.select({ n: sql<number>`count(*)` }).from(schema.leads).where(where).get()?.n ?? 0;
  const seiten = Math.max(1, Math.ceil(total / proSeite));
  const seite = Math.min(f.seite, seiten);

  const spalte = f.sort === 'score' ? schema.leads.score : f.sort === 'gesendet' ? schema.leads.sentAt : schema.leads.createdAt;
  const richtung = f.dir === 'asc' ? asc : desc;
  // Leads ohne Sendedatum immer ans Ende
  const zeilen = db
    .select({ lead: schema.leads, kampagne: schema.campaigns.name })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(where)
    .orderBy(...(f.sort === 'gesendet' ? [asc(sql`${schema.leads.sentAt} is null`)] : []), richtung(spalte), desc(schema.leads.id))
    .limit(proSeite)
    .offset((seite - 1) * proSeite)
    .all();
  return { zeilen, total, seiten, seite };
}

