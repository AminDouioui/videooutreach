import fs from 'fs';
import { NextResponse } from 'next/server';
import { anhangPfad, ladeAnhang, loescheAnhang } from '@/lib/anhaenge-db';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ids(params: Promise<{ id: string; anhangId: string }>): Promise<{ id: number; anhangId: number } | null> {
  const p = await params;
  const id = Number(p.id);
  const anhangId = Number(p.anhangId);
  return Number.isInteger(id) && Number.isInteger(anhangId) ? { id, anhangId } : null;
}

/** Download eines Anhangs (nur angemeldet, nie öffentlich); Inhalt immer als Download, nie inline ausgeführt */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; anhangId: string }> }) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const p = await ids(params);
  const a = p ? ladeAnhang(p.anhangId) : undefined;
  if (!p || !a || a.campaignId !== p.id) return fehler('Anhang nicht gefunden', 404);
  let inhalt: Buffer;
  try {
    inhalt = fs.readFileSync(anhangPfad(a.pfad));
  } catch {
    return fehler('Die Datei fehlt auf dem Server', 404);
  }
  const ascii = a.dateiname.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new NextResponse(new Uint8Array(inhalt), {
    headers: {
      'Content-Type': a.mime,
      'Content-Length': String(inhalt.length),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.dateiname)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

/** Anhang samt Datei entfernen */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; anhangId: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const p = await ids(params);
  const a = p ? ladeAnhang(p.anhangId) : undefined;
  if (!p || !a || a.campaignId !== p.id) return fehler('Anhang nicht gefunden', 404);
  loescheAnhang(a.id);
  return NextResponse.json({ ok: true });
}
