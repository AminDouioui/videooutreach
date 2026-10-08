import { GlobalSettingsForm } from '@/components/GlobalSettingsForm';
import { GmailStatus } from '@/components/GmailStatus';
import { SuppressionList } from '@/components/SuppressionList';
import { ladeEinstellungen } from '@/lib/settings-view';
import { listSuppression } from '@/lib/suppression';

export const dynamic = 'force-dynamic';

export default async function EinstellungenPage({ searchParams }: { searchParams: Promise<{ gmail?: string; detail?: string }> }) {
  const sp = await searchParams;
  const e = ladeEinstellungen();
  const sperrliste = listSuppression().map((r) => ({ email: r.email, reason: r.reason, createdAt: r.createdAt.toISOString() }));

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Einstellungen</h1>
      <GmailStatus connected={e.gmail.connected} email={e.gmail.email} configured={e.gmail.configured} hinweis={sp.gmail} detail={sp.detail} />
      <GlobalSettingsForm
        initial={{ senderName: e.senderName, signature: e.signature, globalDailyLimit: e.globalDailyLimit, impressumUrl: e.impressumUrl, datenschutzUrl: e.datenschutzUrl }}
      />
      <SuppressionList eintraege={sperrliste} />
    </div>
  );
}
