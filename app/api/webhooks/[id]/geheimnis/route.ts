import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db';
import { fehler } from '@/lib/request';
import { erneuereGeheimnis, webhookGeheimnis } from '@/lib/webhooks';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ladeId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isInteger(id) ? id : null;
}

/** Geheimnis anzeigen (nur mit Session). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = await ladeId(params);
  const hook = id === null ? undefined : getDb().select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).get();
  if (!hook) return fehler('Webhook nicht gefunden', 404);
  try {
    return NextResponse.json({ geheimnis: webhookGeheimnis(hook) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return fehler('Das Geheimnis ist nicht lesbar (ENCRYPTION_KEY geändert?). Bitte neu erzeugen.', 500);
  }
}

/** Neues Geheimnis erzeugen; das alte ist sofort ungültig. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = await ladeId(params);
  const neu = id === null ? null : erneuereGeheimnis(id);
  if (!neu) return fehler('Webhook nicht gefunden', 404);
  return NextResponse.json({ geheimnis: neu }, { headers: { 'Cache-Control': 'no-store' } });
}
