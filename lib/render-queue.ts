import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { isInRenderWindow } from './time';

// Gemeinsame Logik für Render-Warteschlange und Fortschritt (API + Worker)

export type RenderModus = 'all' | 'failed';

/** Leads in die Render-Warteschlange stellen. 'all' lässt fertige Leads aus, 'failed' nimmt nur Fehler. */
export function fordereRenderAn(campaignId: number, modus: RenderModus): number {
  const db = getDb();
  return db.transaction((tx) => {
    // Text-Kampagnen werden nie gerendert
    const k = tx.select({ mitVideo: schema.campaigns.mitVideo }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
    if (!k?.mitVideo) return 0;
    const stati = modus === 'failed' ? (['fehler'] as const) : (['wartet', 'fehler'] as const);
    const res = tx
      .update(schema.leads)
      .set({ renderStatus: 'wartet', renderRequested: true, renderError: null })
      // Vom Versand ausgeschlossene Leads (Sperrliste, Firmen-Duplikate) nicht rendern
      .where(and(eq(schema.leads.campaignId, campaignId), inArray(schema.leads.renderStatus, [...stati]), ne(schema.leads.sendStatus, 'uebersprungen')))
      .run();
    // Ein gerade gestoppter, noch laufender Job soll weiterlaufen statt abgebrochen zu werden
    tx.update(schema.leads)
      .set({ renderRequested: true })
      .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.leads.renderStatus, 'rendert')))
      .run();
    if (res.changes > 0) {
      tx.update(schema.campaigns).set({ status: 'rendert' }).where(eq(schema.campaigns.id, campaignId)).run();
    }
    return res.changes;
  });
}

/**
 * Rendern der Kampagne stoppen: Warteschlange leeren und laufende Jobs zum Abbruch markieren
 * (der Worker bricht Leads mit renderStatus 'rendert' und renderRequested = false ab).
 * Die Leads bleiben auf 'wartet' und lassen sich mit „Alle rendern“ fortsetzen.
 */
export function stoppeRender(campaignId: number): number {
  const db = getDb();
  const res = db
    .update(schema.leads)
    .set({ renderRequested: false })
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.leads.renderRequested, true), inArray(schema.leads.renderStatus, ['wartet', 'rendert'])))
    .run();
  schliesseKampagneAb(campaignId);
  return res.changes;
}

/** Einzelnen Lead erzwungen neu rendern (auch wenn fertig). Ein laufender Job wird nicht angefasst. */
export function fordereLeadRenderAn(leadId: number): boolean {
  const db = getDb();
  return db.transaction((tx) => {
    const lead = tx.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead || lead.renderStatus === 'rendert') return false;
    const kampagne = tx.select({ mitVideo: schema.campaigns.mitVideo }).from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
    if (!kampagne?.mitVideo) return false;
    tx.update(schema.leads).set({ renderStatus: 'wartet', renderRequested: true, renderError: null }).where(eq(schema.leads.id, leadId)).run();
    const k = tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
    if (k && (k.status === 'entwurf' || k.status === 'bereit')) {
      tx.update(schema.campaigns).set({ status: 'rendert' }).where(eq(schema.campaigns.id, k.id)).run();
    }
    return true;
  });
}

/** Kampagne von 'rendert' auf 'bereit' setzen, wenn nichts mehr ansteht oder läuft. */
export function schliesseKampagneAb(campaignId: number): void {
  const db = getDb();
  const offen = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.campaignId, campaignId),
        sql`(${schema.leads.renderStatus} = 'rendert' or (${schema.leads.renderStatus} = 'wartet' and ${schema.leads.renderRequested} = 1))`,
      ),
    )
    .get();
  if ((offen?.n ?? 0) === 0) {
    db.update(schema.campaigns).set({ status: 'bereit' }).where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.status, 'rendert'))).run();
  }
}

export type KampagnenStatus = {
  total: number;
  wartet: number;
  rendert: number;
  fertig: number;
  fehler: number;
  angefordert: number;
  nicht_gesendet: number;
  geplant: number;
  gesendet: number;
  versandFehler: number;
  uebersprungen: number;
  campaignStatus: string;
  /** Render-Fenster aus RENDER_WINDOW (null = immer) und ob es gerade offen ist */
  renderFenster: string | null;
  renderFensterOffen: boolean;
};

export function ladeKampagnenStatus(campaignId: number): KampagnenStatus | null {
  const db = getDb();
  const k = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
  if (!k) return null;
  const c = (cond: string) => sql<number>`coalesce(sum(case when ${sql.raw(cond)} then 1 else 0 end), 0)`;
  const r = db
    .select({
      total: sql<number>`count(*)`,
      wartet: c("render_status = 'wartet'"),
      rendert: c("render_status = 'rendert'"),
      fertig: c("render_status = 'fertig'"),
      fehler: c("render_status = 'fehler'"),
      angefordert: c("render_requested = 1 and render_status in ('wartet','rendert')"),
      nicht_gesendet: c("send_status = 'nicht_gesendet'"),
      geplant: c("send_status = 'geplant'"),
      gesendet: c("send_status = 'gesendet'"),
      versandFehler: c("send_status = 'fehler'"),
      uebersprungen: c("send_status = 'uebersprungen'"),
    })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, campaignId))
    .get();
  const fenster = getEnv().RENDER_WINDOW ?? null;
  return { ...r!, campaignStatus: k.status, renderFenster: fenster, renderFensterOffen: isInRenderWindow(fenster ?? undefined) };
}
