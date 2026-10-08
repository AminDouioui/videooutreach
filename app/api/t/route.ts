import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isBotUserAgent } from '@/lib/bots';
import { getDb, schema } from '@/lib/db';
import { RateLimiter } from '@/lib/ratelimit';
import { getClientIpHash, kuerzlichVorhanden, recordEvent, type EventTyp } from '@/lib/tracking';

export const runtime = 'nodejs';

const bodySchema = z.object({
  slug: z.string().min(1).max(80),
  type: z.enum(['page_view', 'play', 'progress_25', 'progress_50', 'progress_75', 'progress_100', 'cta_click']),
  meta: z.record(z.string(), z.unknown()).optional(),
});

// max. 30 Events / Minute je (ip_hash, slug)
const limiter = new RateLimiter(30, 60_000);
const OHNE_WIEDERHOLUNG = new Set<EventTyp>(['play', 'progress_25', 'progress_50', 'progress_75', 'progress_100', 'cta_click']);

const antwort = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/** Tracking-Endpunkt (öffentlich). Akzeptiert JSON und text/plain (sendBeacon); antwortet immer 204. */
export async function POST(req: Request) {
  let roh: unknown;
  try {
    roh = JSON.parse(await req.text());
  } catch {
    return antwort();
  }
  const parsed = bodySchema.safeParse(roh);
  if (!parsed.success) return antwort();
  const { slug, type, meta } = parsed.data;

  const ipHash = getClientIpHash(req);
  if (!limiter.hit(`${ipHash}:${slug}`)) return antwort();

  const lead = getDb().select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, slug)).get();
  if (!lead) return antwort(); // unbekannter Slug: nichts speichern

  if (OHNE_WIEDERHOLUNG.has(type) && kuerzlichVorhanden(lead.id, type, 10_000)) return antwort();

  const ua = req.headers.get('user-agent');
  const metaKlein = meta && JSON.stringify(meta).length <= 1000 ? meta : null;
  recordEvent({ leadId: lead.id, type, meta: metaKlein, ipHash, userAgent: ua, isBot: isBotUserAgent(ua) });
  return antwort();
}
