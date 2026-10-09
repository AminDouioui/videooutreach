import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { kampagnenExtraSpalten, speichereFollowups } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { pruefeVorlage, STANDARD_VARIABLEN } from '@/lib/vorlage';

export const runtime = 'nodejs';

const bodySchema = z.object({
  followups: z
    .array(
      z.object({
        waitDays: z.number().int().min(1, 'Wartezeit mindestens 1 Tag').max(60, 'Wartezeit höchstens 60 Tage'),
        body: z.string().trim().min(1, 'Text eines Follow-ups fehlt').max(20000),
      }),
    )
    .max(10, 'Höchstens 10 Follow-ups'),
});

/** Follow-up-Schritte der Kampagne speichern (ersetzt alle bisherigen) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const bekannt = [...STANDARD_VARIABLEN, ...kampagnenExtraSpalten(id)];
  const klammern: string[] = [];
  const unbekannt = new Set<string>();
  parsed.data.followups.forEach((f, i) => {
    const p = pruefeVorlage(f.body, bekannt);
    klammern.push(...p.fehler.map((m) => `Follow-up ${i + 1}: ${m}`));
    p.unbekannt.forEach((u) => unbekannt.add(u));
  });
  if (klammern.length) return fehler(`Vorlage ungültig: ${klammern.join('; ')}`);
  speichereFollowups(id, parsed.data.followups);
  return NextResponse.json({ ok: true, warnungen: [...unbekannt].map((u) => `Unbekannter Platzhalter {{${u}}}`) });
}
