import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { brainStatus, ladeLeadKontext, loescheBrain, normalisiereBrainUrl, pruefeBrainToken, setzeBrain, testeBrainVerbindung, type BrainFetch } from './brain';
import { getDb, schema } from './db';
import { parseJson } from './request';

// Route-Handler der Brain-Anbindung. `f` ersetzt das fetch zum Brain (Tests). Antworten enthalten nie den Token.

type Kontext = { params: Promise<{ id: string }> };

/** GET /api/leads/[id]/brain-kontext[?frisch=1] → {ok, status: 'ok' | 'nicht_konfiguriert' | 'fehler', daten?, geladenAt?, ausCache?, meldung?} (nur lesend) */
export function brainKontextHandler(f?: BrainFetch) {
  return async (req: Request, ctx: Kontext): Promise<Response> => {
    const id = Number((await ctx.params).id);
    const lead = Number.isInteger(id) ? getDb().select({ id: schema.leads.id, email: schema.leads.email, firma: schema.leads.firma, website: schema.leads.website }).from(schema.leads).where(eq(schema.leads.id, id)).get() : undefined;
    if (!lead) return NextResponse.json({ ok: false, error: 'Lead nicht gefunden' }, { status: 404 });
    const frisch = new URL(req.url).searchParams.get('frisch') === '1';
    const r = await ladeLeadKontext(lead, { fetch: f, frisch });
    return NextResponse.json({ ok: true, ...r }, { headers: { 'Cache-Control': 'no-store' } });
  };
}

const putSchema = z.object({ url: z.string().max(600).optional(), token: z.string().max(2000).optional() });

/** PUT /api/settings/brain {url?, token?}: speichert (Token verschlüsselt); leere Felder bleiben unverändert. */
export function brainSpeichernHandler() {
  return async (req: Request): Promise<Response> => {
    const parsed = await parseJson(req, putSchema);
    if ('response' in parsed) return parsed.response;
    const werte: { url?: string; token?: string } = {};
    if (parsed.data.url?.trim()) {
      const u = normalisiereBrainUrl(parsed.data.url);
      if (!u.ok) return NextResponse.json({ error: u.fehler }, { status: 400 });
      werte.url = u.wert;
    }
    if (parsed.data.token?.trim()) {
      const t = pruefeBrainToken(parsed.data.token);
      if (!t.ok) return NextResponse.json({ error: t.fehler }, { status: 400 });
      werte.token = t.wert;
    }
    if (werte.url === undefined && werte.token === undefined) return NextResponse.json({ error: 'Bitte URL und/oder Token eingeben.' }, { status: 400 });
    setzeBrain(werte);
    return NextResponse.json({ ok: true, brain: brainStatus(true) });
  };
}

/** DELETE /api/settings/brain: entfernt die in der App gespeicherte URL und den Token (Werte aus der .env bleiben). */
export function brainEntfernenHandler() {
  return async (): Promise<Response> => {
    loescheBrain();
    return NextResponse.json({ ok: true, brain: brainStatus(true) });
  };
}

/** POST /api/settings/brain/test {url?, token?}: GET /api/extern/health; mit Eingabe wird diese geprüft, sonst die gespeicherte Konfiguration. */
export function brainTestHandler(f?: BrainFetch) {
  return async (req: Request): Promise<Response> => {
    const parsed = await parseJson(req, putSchema);
    if ('response' in parsed) return parsed.response;
    const eingabe: { url?: string; token?: string } = {};
    if (parsed.data.url?.trim()) {
      const u = normalisiereBrainUrl(parsed.data.url);
      if (!u.ok) return NextResponse.json({ ok: false, meldung: u.fehler });
      eingabe.url = u.wert;
    }
    if (parsed.data.token?.trim()) {
      const t = pruefeBrainToken(parsed.data.token);
      if (!t.ok) return NextResponse.json({ ok: false, meldung: t.fehler });
      eingabe.token = t.wert;
    }
    const r = await testeBrainVerbindung(eingabe, f);
    return NextResponse.json({ ok: r.ok, meldung: r.meldung });
  };
}
