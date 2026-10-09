import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { isGmailConnected, kannAntwortenPruefen } from '@/lib/gmail';
import { fehler, parseJson } from '@/lib/request';
import { brecheVersandAb, countSentToday, ladeFollowups, readSendState } from '@/lib/send';
import { globalDailyLimit } from '@/lib/settings';
import { isWithinWindow, todayBerlin } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ action: z.enum(['start', 'pause', 'resume', 'stop']) });

function laden(id: number) {
  return getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
}

/** Versandstatus der Kampagne für die Anzeige (Heute gesendet, nächster Versand …). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = laden(id);
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const state = readSendState();
  const db = getDb();
  const zaehl = (cond: ReturnType<typeof eq>) => db.select({ n: sql<number>`count(*)` }).from(schema.leads).where(and(eq(schema.leads.campaignId, id), cond)).get()?.n ?? 0;
  return NextResponse.json({
    status: k.status,
    sentToday: countSentToday(id),
    dailyLimit: k.dailySendLimit,
    sentTodayGlobal: countSentToday(),
    globalLimit: globalDailyLimit(),
    nextSendAt: state.nextSendAt,
    quotaStopped: state.quotaStoppedDate === todayBerlin(),
    windowOpen: isWithinWindow(k),
    planned: zaehl(eq(schema.leads.sendStatus, 'geplant')),
    sent: zaehl(eq(schema.leads.sendStatus, 'gesendet')),
    errors: zaehl(eq(schema.leads.sendStatus, 'fehler')),
    gmailConnected: isGmailConnected(),
    // Flow (Follow-ups)
    followupSchritte: ladeFollowups(id).length,
    followupsGesendet: db.select({ n: sql<number>`count(*)` }).from(schema.sentMessages).where(and(eq(schema.sentMessages.campaignId, id), sql`${schema.sentMessages.step} > 0`)).get()?.n ?? 0,
    antworten: zaehl(eq(schema.leads.flowStopp, 'beantwortet')),
    bounces: zaehl(eq(schema.leads.flowStopp, 'bounce')),
    antwortPruefung: kannAntwortenPruefen(),
  });
}

/** Versand starten / pausieren / fortsetzen / abbrechen */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = laden(id);
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const { action } = parsed.data;
  const db = getDb();

  if (action === 'pause') {
    if (k.status !== 'versendet_laufend') return fehler('Versand läuft nicht');
    db.update(schema.campaigns).set({ status: 'pausiert' }).where(eq(schema.campaigns.id, id)).run();
    return NextResponse.json({ ok: true, status: 'pausiert' });
  }

  if (action === 'stop') {
    if (k.status !== 'versendet_laufend' && k.status !== 'pausiert') return fehler('Versand läuft nicht');
    const zurueckgesetzt = brecheVersandAb(id);
    return NextResponse.json({ ok: true, unplanned: zurueckgesetzt });
  }

  if (action === 'start' && k.status === 'versendet_laufend') return fehler('Versand läuft bereits');
  if (action === 'resume' && k.status !== 'pausiert') return fehler('Kampagne ist nicht pausiert');

  // Versandbereite, noch nicht gesendete Leads einplanen (gesperrte werden vom Worker übersprungen).
  // Video-Kampagnen: nur fertig gerenderte; Text-Kampagnen: alle.
  db.update(schema.leads)
    .set({ sendStatus: 'geplant' })
    .where(
      and(
        eq(schema.leads.campaignId, id),
        eq(schema.leads.sendStatus, 'nicht_gesendet'),
        k.mitVideo ? eq(schema.leads.renderStatus, 'fertig') : sql`1 = 1`,
      ),
    )
    .run();
  const gesamtGeplant = db.select({ n: sql<number>`count(*)` }).from(schema.leads).where(and(eq(schema.leads.campaignId, id), eq(schema.leads.sendStatus, 'geplant'))).get()?.n ?? 0;
  // Fortsetzen ist auch erlaubt, wenn nur noch Follow-ups ausstehen
  const offeneFlows = ladeFollowups(id).length > 0
    ? (db
        .select({ n: sql<number>`count(*)` })
        .from(schema.leads)
        .where(and(eq(schema.leads.campaignId, id), eq(schema.leads.sendStatus, 'gesendet'), isNull(schema.leads.flowStopp)))
        .get()?.n ?? 0)
    : 0;
  if (gesamtGeplant === 0 && offeneFlows === 0) {
    return fehler(k.mitVideo ? 'Keine fertig gerenderten Leads zum Versenden vorhanden' : 'Keine Leads zum Versenden vorhanden');
  }

  db.update(schema.campaigns).set({ status: 'versendet_laufend' }).where(eq(schema.campaigns.id, id)).run();
  return NextResponse.json({
    ok: true,
    status: 'versendet_laufend',
    planned: gesamtGeplant,
    warning: isGmailConnected() ? undefined : 'Gmail ist noch nicht verbunden – es wird erst gesendet, wenn die Verbindung steht.',
  });
}
