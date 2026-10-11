import { eq } from 'drizzle-orm';
import { isBotUserAgent } from '@/lib/bots';
import { getDb, schema } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { pruefeLinkToken } from '@/lib/linktracking';
import { RateLimiter } from '@/lib/ratelimit';
import { getClientIpHash, recordEvent } from '@/lib/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// max. 30 Klicks / Minute je (ip_hash, Token); darüber wird weitergeleitet, aber nicht mehr gezählt
const limiter = new RateLimiter(30, 60_000);

const NICHT_GEFUNDEN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Link nicht gefunden</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#334155"><h1 style="font-size:1.25rem">Link nicht gefunden</h1><p>Dieser Link ist ungültig oder nicht mehr verfügbar.</p></body></html>`;

function nichtGefunden(): Response {
  return new Response(NICHT_GEFUNDEN, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

function weiterleitung(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
}

/** Prüft das Token und liefert Ziel-URL und Lead-ID (null = Lead gelöscht); undefined = ungültiges Token. */
async function aufloesen(params: Promise<{ token: string }>) {
  const { token } = await params;
  const t = pruefeLinkToken(getEnv().ENCRYPTION_KEY, token);
  if (!t) return undefined;
  const lead = getDb().select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, t.slug)).get();
  return { token, url: t.url, leadId: lead?.id ?? null };
}

/**
 * Klick-Tracking-Link (öffentlich): GET /api/c/<token>. Das Token ist HMAC-signiert und enthält Lead und Ziel-URL, es
 * wird also nur auf URLs weitergeleitet, die für diesen Lead erzeugt wurden. Loggt `link_click` (Bots mit isBot=true,
 * sie werden trotzdem weitergeleitet). `?vorschau=1` (Vorschau/Testmail) leitet nur weiter, ohne Event.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  let ziel;
  try {
    ziel = await aufloesen(params);
  } catch {
    return nichtGefunden();
  }
  if (!ziel) return nichtGefunden();
  if (ziel.leadId !== null && !new URL(req.url).searchParams.has('vorschau')) {
    try {
      const ipHash = getClientIpHash(req);
      if (limiter.hit(`${ipHash}:${ziel.token}`)) {
        const ua = req.headers.get('user-agent');
        recordEvent({ leadId: ziel.leadId, type: 'link_click', meta: { url: ziel.url }, ipHash, userAgent: ua, isBot: isBotUserAgent(ua) });
      }
    } catch {
      // Die Weiterleitung darf nie am Tracking scheitern
    }
  }
  return weiterleitung(ziel.url);
}

/** HEAD (Link-Scanner, Prefetch): nur weiterleiten, kein Event. */
export async function HEAD(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const ziel = await aufloesen(params);
    return ziel ? weiterleitung(ziel.url) : nichtGefunden();
  } catch {
    return nichtGefunden();
  }
}
