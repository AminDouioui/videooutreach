import { desc, eq, lt } from 'drizzle-orm';
import { decrypt, encrypt } from './crypto';
import { getDb, schema } from './db';
import { AUFBEWAHRUNG_TAGE, neuesGeheimnis, PROTOKOLL_ANZAHL, TEST_EREIGNIS } from './webhook-logik';

// Ausgehende Webhooks: Verwaltung und Auslösen. Das Auslösen legt nur Zustellungen in der DB an (schnell, synchron,
// keine Netzaufrufe); versendet wird im Worker (worker/webhooks.ts, lib/webhook-zustellung.ts).

export type WebhookEreignis = (typeof schema.WEBHOOK_EREIGNISSE)[number];
export type Webhook = typeof schema.webhooks.$inferSelect;

export function istWebhookEreignis(e: string): e is WebhookEreignis {
  return (schema.WEBHOOK_EREIGNISSE as readonly string[]).includes(e);
}

export type LeadDaten = {
  id: number;
  email: string;
  firma: string;
  vorname: string | null;
  nachname: string | null;
  kampagne: { id: number; name: string } | null;
  leadStatus: string;
  score: number;
};

/** Lead-Block der Payload; null = Lead nicht gefunden. */
export function ladeLeadDaten(leadId: number): LeadDaten | null {
  const r = getDb()
    .select({
      id: schema.leads.id,
      email: schema.leads.email,
      firma: schema.leads.firma,
      vorname: schema.leads.vorname,
      nachname: schema.leads.nachname,
      kampagneId: schema.campaigns.id,
      kampagneName: schema.campaigns.name,
      leadStatus: schema.leads.leadStatus,
      score: schema.leads.score,
    })
    .from(schema.leads)
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(eq(schema.leads.id, leadId))
    .get();
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    firma: r.firma,
    vorname: r.vorname,
    nachname: r.nachname,
    kampagne: r.kampagneId != null ? { id: r.kampagneId, name: r.kampagneName ?? '' } : null,
    leadStatus: r.leadStatus,
    score: r.score,
  };
}

/** Beispiel-Lead für Test-Zustellungen */
const TEST_LEAD: LeadDaten = { id: 0, email: 'beispiel@firma.de', firma: 'Beispiel GmbH', vorname: 'Erika', nachname: 'Muster', kampagne: { id: 0, name: 'Beispiel-Kampagne' }, leadStatus: 'offen', score: 0 };

/** Payload einer Zustellung: {ereignis, zeit, daten:{lead, …}} */
function baueNutzlast(ereignis: string, lead: LeadDaten, extra: Record<string, unknown>, jetzt: Date) {
  return { ereignis, zeit: jetzt.toISOString(), daten: { lead, ...extra } };
}

/**
 * Löst ein Ereignis aus: legt für jeden aktiven Webhook, der es abonniert hat, eine offene Zustellung an. Wirft nie
 * (ein Webhook-Problem darf Versand, Tracking oder Statuswechsel nicht stören). Liefert die Zahl der Zustellungen.
 */
export function webhookAusloesen(ereignis: WebhookEreignis, daten: { leadId: number } & Record<string, unknown>, jetzt: Date = new Date()): number {
  try {
    const db = getDb();
    const hooks = db.select({ id: schema.webhooks.id, ereignisse: schema.webhooks.ereignisse }).from(schema.webhooks).where(eq(schema.webhooks.aktiv, true)).all();
    const ziele = hooks.filter((h) => h.ereignisse.includes(ereignis));
    if (ziele.length === 0) return 0;
    const lead = ladeLeadDaten(daten.leadId);
    if (!lead) return 0;
    const { leadId: _leadId, ...extra } = daten;
    void _leadId;
    const payload = baueNutzlast(ereignis, lead, extra, jetzt);
    db.transaction((tx) => {
      for (const h of ziele) tx.insert(schema.webhookZustellungen).values({ webhookId: h.id, ereignis, payload, status: 'offen', naechsterVersuchAt: jetzt, createdAt: jetzt }).run();
    });
    return ziele.length;
  } catch (e) {
    console.error('[webhook] Auslösen fehlgeschlagen:', e instanceof Error ? e.message : e);
    return 0;
  }
}

// ---------------------------------------------------------------- Verwaltung

export function legeWebhookAn(url: string, ereignisse: string[]): Webhook {
  const geheimnis = neuesGeheimnis();
  return getDb().insert(schema.webhooks).values({ url, ereignisse: [...new Set(ereignisse)], geheimnis: encrypt(geheimnis) }).returning().get();
}

/** Klartext-Geheimnis eines Webhooks (für Signatur und Anzeige). */
export function webhookGeheimnis(hook: Pick<Webhook, 'geheimnis'>): string {
  return decrypt(hook.geheimnis);
}

export function erneuereGeheimnis(id: number): string | null {
  const neu = neuesGeheimnis();
  const res = getDb().update(schema.webhooks).set({ geheimnis: encrypt(neu) }).where(eq(schema.webhooks.id, id)).run();
  return res.changes > 0 ? neu : null;
}

export function listeWebhooks(): Webhook[] {
  return getDb().select().from(schema.webhooks).orderBy(schema.webhooks.id).all();
}

/** Legt eine Test-Zustellung (Ereignis 'test') für genau diesen Webhook an. */
export function sendeTest(id: number, jetzt: Date = new Date()): boolean {
  const db = getDb();
  const hook = db.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).get();
  if (!hook) return false;
  const payload = baueNutzlast(TEST_EREIGNIS, TEST_LEAD, { hinweis: 'Das ist eine Test-Zustellung aus dem Dashboard.' }, jetzt);
  db.insert(schema.webhookZustellungen).values({ webhookId: id, ereignis: TEST_EREIGNIS, payload, status: 'offen', naechsterVersuchAt: jetzt, createdAt: jetzt }).run();
  return true;
}

/** Sendet eine Zustellung aus dem Protokoll erneut (neue Zustellung mit gleicher Payload). */
export function sendeErneut(zustellungId: number, jetzt: Date = new Date()): boolean {
  const db = getDb();
  const z = db.select().from(schema.webhookZustellungen).where(eq(schema.webhookZustellungen.id, zustellungId)).get();
  if (!z) return false;
  db.insert(schema.webhookZustellungen).values({ webhookId: z.webhookId, ereignis: z.ereignis, payload: z.payload, status: 'offen', naechsterVersuchAt: jetzt, createdAt: jetzt }).run();
  return true;
}

/** Letzte Zustellungen je Webhook (neueste zuerst, höchstens 100 je Webhook). */
export function ladeProtokoll(webhookIds: number[]): Map<number, (typeof schema.webhookZustellungen.$inferSelect)[]> {
  const ergebnis = new Map<number, (typeof schema.webhookZustellungen.$inferSelect)[]>();
  const db = getDb();
  for (const id of webhookIds) {
    ergebnis.set(id, db.select().from(schema.webhookZustellungen).where(eq(schema.webhookZustellungen.webhookId, id)).orderBy(desc(schema.webhookZustellungen.id)).limit(PROTOKOLL_ANZAHL).all());
  }
  return ergebnis;
}

/** Zustellungen älter als 30 Tage löschen; liefert die Anzahl. */
export function raeumeZustellungenAuf(jetzt: Date = new Date()): number {
  const grenze = new Date(jetzt.getTime() - AUFBEWAHRUNG_TAGE * 24 * 3600_000);
  return getDb().delete(schema.webhookZustellungen).where(lt(schema.webhookZustellungen.createdAt, grenze)).run().changes;
}

