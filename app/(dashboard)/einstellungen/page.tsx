import Link from 'next/link';
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
      <Link href="/einstellungen/integrationen" className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-3 hover:bg-slate-50">
        <span>
          <span className="block text-base font-semibold">Integrationen</span>
          <span className="block text-xs text-slate-500">Webhooks und API-Schlüssel für die REST-API</span>
        </span>
        <span className="text-slate-400">→</span>
      </Link>
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
          bounceSchwellePostfach: e.bounceSchwellePostfach,
          impressumUrl: e.impressumUrl,
          datenschutzUrl: e.datenschutzUrl,
          kiAutoStatus: e.kiAutoStatus,
        }}
        kiAktiv={e.kiAktiv}
        heuteErlaubt={e.heuteErlaubt}
      />
      <SuppressionList eintraege={sperrliste} />
    </div>
  );
}
