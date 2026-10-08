import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { leadPageUrl } from '@/lib/media';
import { fehler } from '@/lib/request';
import { ladeLeadMetriken } from '@/lib/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function zelle(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // CSV-Injection in Excel verhindern
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const datum = (d: Date | null) => (d ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(d) : '');

/** CSV-Export: `;` getrennt, UTF-8 mit BOM (Excel). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const db = getDb();
  const k = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);

  const leads = db.select().from(schema.leads).where(eq(schema.leads.campaignId, id)).all();
  const m = ladeLeadMetriken(id);

  const kopf = ['Firma', 'Anrede', 'Vorname', 'Nachname', 'E-Mail', 'Position', 'Website', 'Render-Status', 'Versand-Status', 'Gesendet am', 'Abgemeldet', 'Aufrufe', 'Videostarts', 'Angeschaut max. %', 'Termin-Klick', 'Score', 'Notizen', 'Link'];
  if (k.trackingPixel) kopf.splice(15, 0, 'Geöffnet (unzuverlässig)');
  const zeilen = leads
    .sort((a, b) => b.score - a.score)
    .map((l) => {
      const x = m.get(l.id);
      const z: unknown[] = [l.firma, l.anrede, l.vorname, l.nachname, l.email, l.position, l.website, l.renderStatus, l.sendStatus, datum(l.sentAt), l.unsubscribed ? 'ja' : 'nein', x?.aufrufe ?? 0, x?.videostarts ?? 0, x?.maxProgress ?? 0, x?.terminKlicks ? 'ja' : 'nein', l.score, l.notizen, leadPageUrl(l.slug)];
      if (k.trackingPixel) z.splice(15, 0, x?.oeffnungen ?? 0);
      return z;
    });
  const csv = '﻿' + [kopf, ...zeilen].map((r) => r.map(zelle).join(';')).join('\r\n') + '\r\n';
  const name = k.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kampagne';
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-${name}.csv"`, 'Cache-Control': 'no-store' },
  });
}
