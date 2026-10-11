import Link from 'next/link';
import { ApiSchluesselVerwaltung } from '@/components/ApiSchluesselVerwaltung';
import { BrainVerbindung } from '@/components/BrainVerbindung';
import { WebhooksVerwaltung } from '@/components/WebhooksVerwaltung';
import { listeSchluessel } from '@/lib/api-schluessel';
import { brainStatus } from '@/lib/brain';
import { privateZieleErlaubt } from '@/lib/webhook-logik';
import { ladeProtokoll, listeWebhooks } from '@/lib/webhooks';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

export default async function IntegrationenPage() {
  await erforderSeitenRolle('admin');
  const hooks = listeWebhooks();
  const protokoll = ladeProtokoll(hooks.map((h) => h.id));
  const webhooks = hooks.map((h) => ({
    id: h.id,
    url: h.url,
    ereignisse: h.ereignisse,
    aktiv: h.aktiv,
    zustellungen: (protokoll.get(h.id) ?? []).map((z) => ({
      id: z.id,
      ereignis: z.ereignis,
      status: z.status,
      versuche: z.versuche,
      httpStatus: z.httpStatus,
      letzterFehler: z.letzterFehler,
      createdAt: z.createdAt.toISOString(),
      naechsterVersuchAt: z.naechsterVersuchAt ? z.naechsterVersuchAt.toISOString() : null,
    })),
  }));
  const schluessel = listeSchluessel().map((k) => ({
    id: k.id,
    name: k.name,
    praefix: k.praefix,
    rechte: k.rechte,
    letzteNutzungAt: k.letzteNutzungAt ? k.letzteNutzungAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
    widerrufenAt: k.widerrufenAt ? k.widerrufenAt.toISOString() : null,
  }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/einstellungen" className="text-xs text-slate-500 hover:underline">
          ← Einstellungen
        </Link>
        <h1 className="text-xl font-semibold">Integrationen</h1>
        <p className="mt-1 text-sm text-slate-600">
          Webhooks melden Ereignisse an andere Systeme, die REST-API liest Kampagnen und legt Leads an, das Brain liefert Hintergrundwissen zu Leads. Beschreibung mit Beispielen: <code>docs/api.md</code>.
        </p>
      </div>
      <WebhooksVerwaltung webhooks={webhooks} privatErlaubt={privateZieleErlaubt()} />
      <ApiSchluesselVerwaltung schluessel={schluessel} />
      <BrainVerbindung initial={brainStatus(true)} />
    </div>
  );
}
