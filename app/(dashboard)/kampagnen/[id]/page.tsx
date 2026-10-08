import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/Badge';
import { CampaignActions } from '@/components/CampaignActions';
import { LeadsTable, type LeadRow } from '@/components/LeadsTable';
import { getDb, schema } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ladeLeadMetriken } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

export default async function KampagnenDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!kampagne) notFound();

  const leads = db.select().from(schema.leads).where(eq(schema.leads.campaignId, id)).all();
  const metriken = ladeLeadMetriken(id);
  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    firma: l.firma,
    ansprechpartner: [l.vorname, l.nachname].filter(Boolean).join(' '),
    email: l.email,
    slug: l.slug,
    renderStatus: l.renderStatus,
    sendStatus: l.sendStatus,
    sentAt: l.sentAt ? l.sentAt.getTime() : null,
    aufrufe: metriken.get(l.id)?.aufrufe ?? 0,
    videostarts: metriken.get(l.id)?.videostarts ?? 0,
    maxProgress: metriken.get(l.id)?.maxProgress ?? 0,
    terminKlicks: metriken.get(l.id)?.terminKlicks ?? 0,
    oeffnungen: metriken.get(l.id)?.oeffnungen ?? 0,
    score: l.score,
  }));
  const gerendert = leads.filter((l) => l.renderStatus === 'fertig').length;

  return (
    <div>
      <p className="mb-1 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">
          Kampagnen
        </Link>{' '}
        / {kampagne.name}
      </p>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold">
            {kampagne.name} <Badge status={kampagne.status} />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {gerendert} / {leads.length} gerendert · Termin-Link: {kampagne.ctaUrl}
          </p>
        </div>
        <CampaignActions campaignId={kampagne.id} leadCount={leads.length} />
      </div>
      <LeadsTable leads={rows} baseUrl={getEnv().APP_URL} campaignId={kampagne.id} trackingPixel={kampagne.trackingPixel} />
    </div>
  );
}
