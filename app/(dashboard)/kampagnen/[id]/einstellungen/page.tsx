import Link from 'next/link';
import { asc, eq, ne } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { CampaignSettingsForm } from '@/components/CampaignSettingsForm';
import { UntersequenzenVerwaltung } from '@/components/UntersequenzenVerwaltung';
import { getDb, schema } from '@/lib/db';
import { parseSendDays } from '@/lib/time';
import { ladeRegeln } from '@/lib/untersequenzen-db';
import { Schreibschutz } from '@/components/Schreibschutz';
import { hatRolle } from '@/lib/auth';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

export default async function KampagnenEinstellungen({ params }: { params: Promise<{ id: string }> }) {
  const me = await erforderSeitenRolle();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const k = getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) notFound();

  const ziele = getDb().select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).where(ne(schema.campaigns.id, id)).orderBy(asc(schema.campaigns.name)).all();

  return (
    <div className="max-w-2xl">
      <p className="mb-1 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">Kampagnen</Link> /{' '}
        <Link href={`/kampagnen/${id}`} className="text-slate-500 hover:underline">{k.name}</Link> / Einstellungen
      </p>
      <h1 className="mb-4 text-xl font-semibold">Kampagnen-Einstellungen</h1>
      <Schreibschutz gesperrt={!hatRolle(me.rolle, 'mitglied')} hinweis="Nur Ansicht: Mit Ihrer Rolle können Sie die Einstellungen nicht ändern.">
      <CampaignSettingsForm
        campaignId={id}
        initial={{
          name: k.name,
          ctaUrl: k.ctaUrl,
          dailySendLimit: k.dailySendLimit,
          sendWindowStart: k.sendWindowStart,
          sendWindowEnd: k.sendWindowEnd,
          sendDays: parseSendDays(k.sendDays),
          zeitzone: k.zeitzone,
          startDatum: k.startDatum ?? '',
          maxNeueLeadsProTag: k.maxNeueLeadsProTag,
          trackingPixel: k.trackingPixel,
          linkTracking: k.linkTracking,
          stoppBeiFirmenAntwort: k.stoppBeiFirmenAntwort,
          abwesenheitVerschiebenTage: k.abwesenheitVerschiebenTage,
          bounceSchutz: k.bounceSchutz,
          bounceSchwelleProzent: k.bounceSchwelleProzent,
          bounceFenster: k.bounceFenster,
        }}
      />
      <UntersequenzenVerwaltung campaignId={id} regeln={ladeRegeln(id)} ziele={ziele} />
      </Schreibschutz>
    </div>
  );
}
