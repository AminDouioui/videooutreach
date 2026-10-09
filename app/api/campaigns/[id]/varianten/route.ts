import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { naechstesKuerzel } from '@/lib/varianten';
import { ladeVarianten, pruefeVariante, varianteSchema } from '@/lib/varianten-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Wie viele gesendete Leads je Kürzel die Variante bekommen haben */
function verwendung(campaignId: number): Map<string, number> {
  const rows = getDb()
    .select({ k: schema.leads.variante, n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, campaignId))
    .groupBy(schema.leads.variante)
    .all();
  return new Map(rows.filter((r) => r.k).map((r) => [r.k as string, r.n]));
}

/** Zusatzvarianten (B, C …) der Kampagne samt Anzahl Leads, die sie bekommen haben */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const v = verwendung(id);
  return NextResponse.json({ varianten: ladeVarianten(id).map((x) => ({ id: x.id, kuerzel: x.kuerzel, betreff: x.betreff, text: x.text, aktiv: x.aktiv, verwendet: v.get(x.kuerzel) ?? 0 })) });
}

/** Neue Variante anlegen (nächstes freies Kürzel, höchstens 5 Varianten insgesamt) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const parsed = await parseJson(req, varianteSchema);
  if ('response' in parsed) return parsed.response;
  const p = pruefeVariante(id, parsed.data.betreff, parsed.data.text);
  if (p.fehler) return fehler(p.fehler);
  const kuerzel = naechstesKuerzel(ladeVarianten(id).map((v) => v.kuerzel));
  if (!kuerzel) return fehler('Höchstens 5 Varianten (A bis E) pro Kampagne');
  const [neu] = getDb()
    .insert(schema.varianten)
    .values({ campaignId: id, kuerzel, betreff: parsed.data.betreff, text: parsed.data.text, aktiv: parsed.data.aktiv ?? true })
    .returning()
    .all();
  return NextResponse.json({ ok: true, variante: { ...neu, verwendet: 0 }, warnungen: p.warnungen }, { status: 201 });
}
