import { GlobalSettingsForm } from '@/components/GlobalSettingsForm';
import { PostfaecherVerwaltung } from '@/components/PostfaecherVerwaltung';
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
      <PostfaecherVerwaltung postfaecher={e.postfaecher} konfiguriert={e.gmailKonfiguriert} hinweis={sp.gmail} detail={sp.detail} />
      <GlobalSettingsForm
        initial={{
          senderName: e.senderName,
          signature: e.signature,
          globalDailyLimit: e.globalDailyLimit,
          rampeAktiv: e.rampeAktiv,
          rampeStart: e.rampeStart,
          rampeSchritt: e.rampeSchritt,
          rampeBeginn: e.rampeBeginn,
          impressumUrl: e.impressumUrl,
          datenschutzUrl: e.datenschutzUrl,
        }}
        heuteErlaubt={e.heuteErlaubt}
      />
      <SuppressionList eintraege={sperrliste} />
    </div>
  );
}
