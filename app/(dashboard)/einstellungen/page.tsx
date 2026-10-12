import Link from 'next/link';
import { GlobalSettingsForm } from '@/components/GlobalSettingsForm';
import { KiSchluessel } from '@/components/KiSchluessel';
import { PostfaecherVerwaltung } from '@/components/PostfaecherVerwaltung';
import { SuppressionList } from '@/components/SuppressionList';
import { ladeEinstellungen } from '@/lib/settings-view';
import { listSuppression } from '@/lib/suppression';
import { Schreibschutz } from '@/components/Schreibschutz';
import { hatRolle } from '@/lib/auth';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

export default async function EinstellungenPage({ searchParams }: { searchParams: Promise<{ gmail?: string; detail?: string }> }) {
  const me = await erforderSeitenRolle();
  const istAdmin = hatRolle(me.rolle, 'admin');
  const sp = await searchParams;
  const e = ladeEinstellungen(istAdmin);
  const sperrliste = listSuppression().map((r) => ({ email: r.email, reason: r.reason, createdAt: r.createdAt.toISOString() }));

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Einstellungen</h1>
      {istAdmin && (
        <>
          <Link href="/einstellungen/integrationen" className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-3 hover:bg-slate-50">
            <span>
              <span className="block text-base font-semibold">Integrationen</span>
              <span className="block text-xs text-slate-500">Webhooks, API-Schlüssel für die REST-API und Brain-Anbindung</span>
            </span>
            <span className="text-slate-400">→</span>
          </Link>
          <Link href="/einstellungen/benutzer" className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-3 hover:bg-slate-50">
            <span>
              <span className="block text-base font-semibold">Benutzer</span>
              <span className="block text-xs text-slate-500">Team einladen, Rollen vergeben, Zugänge sperren</span>
            </span>
            <span className="text-slate-400">→</span>
          </Link>
        </>
      )}
      <KiSchluessel initial={e.kiSchluessel} istAdmin={istAdmin} />
      <Schreibschutz gesperrt={!istAdmin} hinweis="Nur Ansicht: Postfächer und globale Einstellungen ändern nur Admins.">
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
          schreibregelnAktiv: e.schreibregelnAktiv,
          kiAutoStatus: e.kiAutoStatus,
          kiKlassifizierer: e.kiKlassifizierer ?? 'anthropic',
          kiEntwurfAnbieter: e.kiEntwurfAnbieter ?? 'anthropic',
          openaiModell: e.openaiModell,
          jevModell: e.jevModell,
          typesafeModell: e.typesafeModell,
        }}
        kiAktiv={e.kiAktiv}
        klassifiziererOptionen={e.kiKlassifiziererOptionen}
        entwurfOptionen={e.kiEntwurfAnbieterOptionen}
        modellStandard={{ openai: e.openaiModellStandard, jev: e.jevModellStandard, typesafe: e.typesafeModellStandard }}
        jevAnbieter={e.jevAnbieter}
        heuteErlaubt={e.heuteErlaubt}
      />
      </Schreibschutz>
      <Schreibschutz gesperrt={!hatRolle(me.rolle, 'mitglied')}>
        <SuppressionList eintraege={sperrliste} />
      </Schreibschutz>
    </div>
  );
}
