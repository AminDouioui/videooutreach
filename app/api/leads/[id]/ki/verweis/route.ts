import { NextResponse } from 'next/server';
import { mitRolle } from '@/lib/session';
import { legeVerweisLeadAn } from '@/lib/verweis-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Legt aus dem in der Antwort erkannten Verweis einen neuen Lead in derselben Kampagne an → {ok, neuerLeadId}. */
export const POST = mitRolle('mitglied', async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: 'Ungültiger Lead' }, { status: 404 });
  const r = legeVerweisLeadAn(id);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
});
