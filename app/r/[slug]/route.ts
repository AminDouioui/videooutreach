import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { RateLimiter } from '@/lib/ratelimit';
import { getClientIpHash } from '@/lib/tracking';
import { erfasseVideoKlick } from '@/lib/video-klick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// max. 30 Klicks / Minute je (ip_hash, slug); darüber wird weitergeleitet, aber nicht mehr gezählt
const limiter = new RateLimiter(30, 60_000);

const NICHT_GEFUNDEN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Link nicht gefunden</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#334155"><h1 style="font-size:1.25rem">Link nicht gefunden</h1><p>Dieser Link ist ungültig oder nicht mehr verfügbar.</p></body></html>`;

const KOPF = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

function nichtGefunden(): Response {
  return new Response(NICHT_GEFUNDEN, { status: 404, headers: { ...KOPF, 'Content-Type': 'text/html; charset=utf-8' } });
}

function weiterleitung(slug: string): Response {
  return new Response(null, { status: 302, headers: { ...KOPF, Location: `/v/${encodeURIComponent(slug)}` } });
}

function ladeLeadId(slug: string): number | null {
  return getDb().select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, slug)).get()?.id ?? null;
}

/**
 * Video-Link in der Mail (öffentlich): GET /r/<slug>. Erfasst `video_link_click` und leitet per 302 auf /v/<slug>.
 * Unbekannter Slug: neutrale 404-Seite. Bots (User-Agent, Klick kurz nach Versand, Klickserie) werden als Bot
 * gespeichert und trotzdem weitergeleitet. `?vorschau=1` (Vorschau/Testmail) leitet nur weiter, ohne Event.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let leadId: number | null;
  try {
    leadId = ladeLeadId(slug);
  } catch {
    return nichtGefunden();
  }
  if (leadId === null) return nichtGefunden();
  if (!new URL(req.url).searchParams.has('vorschau')) {
    try {
      const ipHash = getClientIpHash(req);
      if (limiter.hit(`${ipHash}:${slug}`)) erfasseVideoKlick({ leadId, userAgent: req.headers.get('user-agent'), ipHash });
    } catch {
      // Die Weiterleitung darf nie am Tracking scheitern
    }
  }
  return weiterleitung(slug);
}

/** HEAD (Link-Scanner, Prefetch): nur weiterleiten, kein Event. */
export async function HEAD(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return ladeLeadId(slug) !== null ? weiterleitung(slug) : nichtGefunden();
  } catch {
    return nichtGefunden();
  }
}
