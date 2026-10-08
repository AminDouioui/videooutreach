import { eq } from 'drizzle-orm';
import { isBotUserAgent } from '@/lib/bots';
import { getDb, schema } from '@/lib/db';
import { getClientIpHash, recordEvent } from '@/lib/tracking';

export const runtime = 'nodejs';

// 1x1 transparentes GIF
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Öffnungs-Pixel: GET /api/o/{slug}.gif. Loggt email_open nur bei aktivem tracking_pixel der Kampagne. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([a-z0-9-]+)\.gif$/.exec(file);
  if (m) {
    try {
      const db = getDb();
      const row = db
        .select({ id: schema.leads.id, pixel: schema.campaigns.trackingPixel })
        .from(schema.leads)
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
        .where(eq(schema.leads.slug, m[1]))
        .get();
      if (row?.pixel) {
        const ua = req.headers.get('user-agent');
        recordEvent({ leadId: row.id, type: 'email_open', ipHash: getClientIpHash(req), userAgent: ua, isBot: isBotUserAgent(ua) });
      }
    } catch {
      // Pixel darf nie fehlschlagen
    }
  }
  return new Response(new Uint8Array(GIF), {
    headers: { 'Content-Type': 'image/gif', 'Content-Length': String(GIF.length), 'Cache-Control': 'no-store, max-age=0' },
  });
}
