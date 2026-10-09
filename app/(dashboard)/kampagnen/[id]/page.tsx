import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/Badge';
import { CampaignActions } from '@/components/CampaignActions';
import { RenderProgress } from '@/components/RenderProgress';
import { ladeKampagnenStatus } from '@/lib/render-queue';
import { LeadsTable, type LeadRow } from '@/components/LeadsTable';
import { SendControls } from '@/components/SendControls';
import { getDb, schema } from '@/lib/db';
import { duplikatReihenfolge, FIRMEN_DUPLIKAT } from '@/lib/campaigns';
import { getEnv } from '@/lib/env';
import { firmenDuplikate } from '@/lib/firma';
import { ladeFollowups } from '@/lib/send';
import { ladeVariantenStatistik } from '@/lib/varianten-statistik';
import { VariantenTabelle } from '@/components/VariantenTabelle';
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
  // Je Firma gilt der zuerst angeschriebene bzw. zuerst importierte Kontakt als Original
  const duplikate = firmenDuplikate(duplikatReihenfolge(leads));
  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    firma: l.firma,
    ansprechpartner: [l.vorname, l.nachname].filter(Boolean).join(' '),
    email: l.email,
    slug: l.slug,
    renderStatus: l.renderStatus,
    sendStatus: l.sendStatus,
    leadStatus: l.leadStatus,
    sentAt: l.sentAt ? l.sentAt.getTime() : null,
    aufrufe: metriken.get(l.id)?.aufrufe ?? 0,
    videostarts: metriken.get(l.id)?.videostarts ?? 0,
    maxProgress: metriken.get(l.id)?.maxProgress ?? 0,
    terminKlicks: metriken.get(l.id)?.terminKlicks ?? 0,
    oeffnungen: metriken.get(l.id)?.oeffnungen ?? 0,
    score: l.score,
    variante: l.variante,
    flowSchritt: l.sendStatus === 'gesendet' ? 1 + l.followupsSent : 0,
    flowStopp: l.flowStopp,
    firmenDuplikat: duplikate.has(l.id),
    duplikatAusgeschlossen: l.sendStatus === 'uebersprungen' && l.sendError === FIRMEN_DUPLIKAT,
  }));
  const variantenStatistik = ladeVariantenStatistik(id);
  const abTest = variantenStatistik.length > 1;
  const gerendert = leads.filter((l) => l.renderStatus === 'fertig').length;
  const followupSchritte = ladeFollowups(id).length;
  // Text-Kampagnen sind sofort versandbereit
  const versandbereit = kampagne.mitVideo ? gerendert : leads.length;

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
            {kampagne.mitVideo ? `${gerendert} / ${leads.length} gerendert` : `Text-Kampagne · ${leads.length} Leads`} ·{' '}
            {followupSchritte > 0 ? `Flow: Erstmail + ${followupSchritte} Follow-up${followupSchritte === 1 ? '' : 's'}` : 'Nur Erstmail'} · Termin-Link: {kampagne.ctaUrl}
          </p>
        </div>
        <CampaignActions campaignId={kampagne.id} campaignName={kampagne.name} leadCount={leads.length} mitVideo={kampagne.mitVideo} />
      </div>
      {kampagne.mitVideo && <RenderProgress campaignId={kampagne.id} initial={ladeKampagnenStatus(kampagne.id)!} />}
      <div className="mb-4">
        <SendControls campaignId={kampagne.id} readyCount={versandbereit} />
      </div>
      {abTest && <VariantenTabelle statistik={variantenStatistik} mitVideo={kampagne.mitVideo} />}
      <LeadsTable
        leads={rows}
        baseUrl={getEnv().APP_URL}
        campaignId={kampagne.id}
        trackingPixel={kampagne.trackingPixel}
        mitVideo={kampagne.mitVideo}
        followupSchritte={followupSchritte}
        abTest={abTest}
      />
    </div>
  );
}
