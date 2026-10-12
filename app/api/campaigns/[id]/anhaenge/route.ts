import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { MAX_ANZAHL, MAX_DATEI_BYTES, MAX_GESAMT_BYTES } from '@/lib/anhaenge';
import { ladeAnhaenge, speichereAnhang } from '@/lib/anhaenge-db';
import { getDb, schema } from '@/lib/db';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `followupId` aus der Query bzw. dem Formular: fehlt/leer = Erstmail (null), sonst Zahl; ungültig = undefined */
function leseFollowupId(roh: string | null | FormDataEntryValue): number | null | undefined {
  if (roh === null || roh === '') return null;
  if (typeof roh !== 'string' || !/^\d{1,9}$/.test(roh)) return undefined;
  return Number(roh);
}

function dto(a: ReturnType<typeof ladeAnhaenge>[number]) {
  return { id: a.id, followupId: a.followupId, dateiname: a.dateiname, mime: a.mime, groesse: a.groesse, createdAt: a.createdAt };
}

const LIMITS = { maxDateiBytes: MAX_DATEI_BYTES, maxGesamtBytes: MAX_GESAMT_BYTES, maxAnzahl: MAX_ANZAHL };

/** Anhänge der Kampagne: ohne Query alle, mit `?followupId=` ein Schritt (leer = Erstmail) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const q = new URL(req.url).searchParams;
  let anhaenge = getDb().select().from(schema.anhaenge).where(eq(schema.anhaenge.campaignId, id)).orderBy(schema.anhaenge.id).all();
  if (q.has('followupId')) {
    const fid = leseFollowupId(q.get('followupId'));
    if (fid === undefined) return fehler('Ungültiges Follow-up');
    anhaenge = ladeAnhaenge(id, fid);
  }
  return NextResponse.json({ anhaenge: anhaenge.map(dto), limits: LIMITS });
}

/** Anhang hochladen: multipart/form-data mit `datei` (File) und optional `followupId` (leer = Erstmail) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);

  // Große Uploads früh abweisen, bevor sie in den Speicher gelesen werden (Rahmen: Datei + Multipart-Overhead)
  const laenge = Number(req.headers.get('content-length') ?? 0);
  if (laenge > MAX_DATEI_BYTES + 256 * 1024) return fehler(`Datei zu groß (erlaubt sind 10 MB je Datei)`, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fehler('Ungültiger Upload (multipart/form-data erwartet)');
  }
  const followupId = leseFollowupId(form.get('followupId'));
  if (followupId === undefined) return fehler('Ungültiges Follow-up');
  const datei = form.get('datei');
  if (!(datei instanceof File)) return fehler('Keine Datei übergeben (Feld „datei“)');
  if (datei.size > MAX_DATEI_BYTES) return fehler(`„${datei.name}“ ist zu groß (erlaubt sind 10 MB je Datei)`, 413);

  const res = speichereAnhang(id, followupId, datei.name, Buffer.from(await datei.arrayBuffer()));
  if (!res.ok) return fehler(res.fehler, res.status);
  return NextResponse.json({ ok: true, anhang: dto(res.anhang) }, { status: 201 });
}
