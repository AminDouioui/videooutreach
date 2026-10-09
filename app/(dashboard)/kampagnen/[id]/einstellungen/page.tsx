import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { CampaignSettingsForm } from '@/components/CampaignSettingsForm';
import { getDb, schema } from '@/lib/db';
import { parseSendDays } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function KampagnenEinstellungen({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const k = getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) notFound();

  return (
    <div className="max-w-2xl">
      <p className="mb-1 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">Kampagnen</Link> /{' '}
        <Link href={`/kampagnen/${id}`} className="text-slate-500 hover:underline">{k.name}</Link> / Einstellungen
      </p>
      <h1 className="mb-4 text-xl font-semibold">Kampagnen-Einstellungen</h1>
      <CampaignSettingsForm
        campaignId={id}
        initial={{
          name: k.name,
          ctaUrl: k.ctaUrl,
          dailySendLimit: k.dailySendLimit,
          sendWindowStart: k.sendWindowStart,
          sendWindowEnd: k.sendWindowEnd,
          sendDays: parseSendDays(k.sendDays),
          startDatum: k.startDatum ?? '',
          maxNeueLeadsProTag: k.maxNeueLeadsProTag,
          trackingPixel: k.trackingPixel,
          stoppBeiFirmenAntwort: k.stoppBeiFirmenAntwort,
        }}
      />
    </div>
  );
}
