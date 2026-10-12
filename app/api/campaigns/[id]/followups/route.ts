import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { kampagnenExtraSpalten, speichereFollowups } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { MAX_VARIANTEN } from '@/lib/varianten';
import { pruefeVorlage, STANDARD_VARIABLEN } from '@/lib/vorlage';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  followups: z
    .array(
      z.object({
        // Bestehender Schritt (behält seine Anhänge)
        id: z.number().int().positive().optional(),
        waitDays: z.number().int().min(1, 'Wartezeit mindestens 1 Tag').max(60, 'Wartezeit höchstens 60 Tage'),
        body: z.string().trim().min(1, 'Text eines Follow-ups fehlt').max(20000),
        // Eigener Betreff von Variante A: gesetzt = neuer Thread
        betreff: z.string().trim().max(300).nullish(),
        // Zusatzvarianten B–E (A ist body/betreff)
        varianten: z
          .array(
            z.object({
              kuerzel: z.string().regex(/^[B-E]$/, 'Ungültiges Kürzel'),
              text: z.string().trim().min(1, 'Text einer Variante fehlt').max(20000),
              betreff: z.string().trim().max(300).nullish(),
              aktiv: z.boolean().optional(),
            }),
          )
          .max(MAX_VARIANTEN - 1, 'Höchstens 5 Varianten (A bis E) je Follow-up')
          .optional(),
      }),
    )
    .max(10, 'Höchstens 10 Follow-ups'),
});

/** Follow-up-Schritte der Kampagne speichern (ersetzt alle bisherigen) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
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
    const teile: [string, string][] = [['', f.body], ...(f.betreff ? ([['Betreff: ', f.betreff]] as [string, string][]) : [])];
    for (const v of f.varianten ?? []) {
      teile.push([`Variante ${v.kuerzel}: `, v.text]);
      if (v.betreff) teile.push([`Variante ${v.kuerzel} Betreff: `, v.betreff]);
    }
    for (const [prefix, text] of teile) {
      const p = pruefeVorlage(text, bekannt);
      klammern.push(...p.fehler.map((m) => `Follow-up ${i + 1}: ${prefix}${m}`));
      p.unbekannt.forEach((u) => unbekannt.add(u));
    }
    const kuerzel = (f.varianten ?? []).map((v) => v.kuerzel);
    if (new Set(kuerzel).size !== kuerzel.length) klammern.push(`Follow-up ${i + 1}: Kürzel doppelt`);
  });
  if (klammern.length) return fehler(`Vorlage ungültig: ${klammern.join('; ')}`);
  const ids = speichereFollowups(id, parsed.data.followups);
  return NextResponse.json({ ok: true, ids, warnungen: [...unbekannt].map((u) => `Unbekannter Platzhalter {{${u}}}`) });
}
