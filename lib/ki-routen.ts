import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { kampagnenExtraSpalten } from './campaigns';
import { getDb, schema } from './db';
import { kiAktiv, KI_NICHT_AKTIV, KiFehler, schlageVorlageVor, anthropicClient } from './ki';
import { entwerfeLeadAntwort, ordneLeadEin, uebernimmEinordnung, type KiOptionen } from './ki-einordnung';

// Route-Handler der KI-Funktionen. Ohne ANTHROPIC_API_KEY (und ohne injizierten Client) antworten alle mit 404 und
// einer Meldung – es wird nichts angefragt. `opt` ersetzt Client/Gmail (Tests).

type Kontext = { params: Promise<{ id: string }> };

function nichtAktiv(opt: KiOptionen): NextResponse | null {
  return opt.ki || kiAktiv() ? null : NextResponse.json({ ok: false, error: KI_NICHT_AKTIV }, { status: 404 });
}

async function idAus(ctx: Kontext): Promise<number | null> {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) ? id : null;
}

const vorschlagSchema = z.object({
  beschreibung: z.string().trim().min(1, 'Bitte kurz beschreiben, worum es geht.').max(1500),
  art: z.enum(['erstmail', 'followup']),
  nr: z.number().int().min(1).max(20).optional(),
  spintax: z.boolean().optional(),
  mitBetreff: z.boolean().optional(),
});

/** POST /api/campaigns/[id]/ki/vorlage {beschreibung, art, nr?, spintax?, mitBetreff?} → {ok, betreff, text} */
export function vorlageHandler(opt: KiOptionen = {}) {
  return async (req: Request, ctx: Kontext): Promise<Response> => {
    const aus = nichtAktiv(opt);
    if (aus) return aus;
    const id = await idAus(ctx);
    const kampagne = id === null ? undefined : getDb().select({ mitVideo: schema.campaigns.mitVideo }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
    if (id === null || !kampagne) return NextResponse.json({ ok: false, error: 'Kampagne nicht gefunden' }, { status: 404 });
    const parsed = vorschlagSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' }, { status: 400 });
    try {
      const v = await schlageVorlageVor({ ...parsed.data, mitVideo: kampagne.mitVideo, extraSpalten: kampagnenExtraSpalten(id) }, opt.ki ?? anthropicClient);
      return NextResponse.json({ ok: true, ...v });
    } catch (e) {
      const f = e instanceof KiFehler ? e : new KiFehler('Unerwarteter Fehler bei der KI-Anfrage.', 'anfrage');
      return NextResponse.json({ ok: false, error: f.message }, { status: f.art === 'anfrage' || f.art === 'antwort' ? 422 : 502 });
    }
  };
}

function leadHandler<T extends { ok: true }>(opt: KiOptionen, lauf: (id: number) => Promise<T | { ok: false; status: number; error: string }> | T | { ok: false; status: number; error: string }) {
  return async (_req: Request, ctx: Kontext): Promise<Response> => {
    const aus = nichtAktiv(opt);
    if (aus) return aus;
    const id = await idAus(ctx);
    if (id === null) return NextResponse.json({ ok: false, error: 'Ungültiger Lead' }, { status: 404 });
    const res = await lauf(id);
    return res.ok ? NextResponse.json(res) : NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  };
}

/** POST /api/leads/[id]/ki/einordnen → {ok, einordnung, angewendet} */
export const einordnenHandler = (opt: KiOptionen = {}) => leadHandler(opt, (id) => ordneLeadEin(id, opt));

/** POST /api/leads/[id]/ki/uebernehmen → gespeicherte Einordnung anwenden */
export const uebernehmenHandler = (opt: KiOptionen = {}) => leadHandler(opt, (id) => uebernimmEinordnung(id, opt.jetzt));

/** POST /api/leads/[id]/ki/entwurf → {ok, text} (nichts wird gesendet) */
export const entwurfHandler = (opt: KiOptionen = {}) => leadHandler(opt, (id) => entwerfeLeadAntwort(id, opt));
