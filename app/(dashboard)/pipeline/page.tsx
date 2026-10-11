import { asc, eq, or, ne } from 'drizzle-orm';
import { PipelineBoard, type PipelineKarte } from '@/components/PipelineBoard';
import { getDb, schema } from '@/lib/db';
import { hatRolle } from '@/lib/auth';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Pipeline({ searchParams }: { searchParams: SP }) {
  const me = await erforderSeitenRolle();
  const sp = await searchParams;
  const roh = Number(Array.isArray(sp.kampagne) ? sp.kampagne[0] : sp.kampagne);
  const db = getDb();
  const kampagnen = db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).orderBy(asc(schema.campaigns.name)).all();
  const campaignId = Number.isInteger(roh) && kampagnen.some((k) => k.id === roh) ? roh : null;

  // Nur Leads mit Antwort oder Status ≠ offen (die Spalten bildet aggregierePipeline)
  const zeilen = db
    .select({ lead: schema.leads, kampagne: schema.campaigns.name })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(or(ne(schema.leads.leadStatus, 'offen'), eq(schema.leads.flowStopp, 'beantwortet')))
    .all();
  const leads: PipelineKarte[] = zeilen.map(({ lead: l, kampagne }) => ({
    id: l.id,
    campaignId: l.campaignId,
    leadStatus: l.leadStatus,
    leadStatusAt: l.leadStatusAt?.getTime() ?? null,
    flowStopp: l.flowStopp,
    antwortAt: l.antwortAt?.getTime() ?? null,
    flowStoppAt: l.flowStoppAt?.getTime() ?? null,
    dealWert: l.dealWert,
    dealNotiz: l.dealNotiz,
    firma: l.firma,
    name: [l.vorname, l.nachname].filter(Boolean).join(' '),
    email: l.email,
    kampagne,
  }));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Pipeline</h1>
      <p className="mb-4 text-sm text-slate-500">
        Leads mit Antwort oder Lead-Status nach Status. Karten per Drag-and-drop in eine andere Spalte ziehen oder den Status auf der Karte wählen – es gelten dieselben Regeln wie überall (z. B. beendet „Verloren“ den Flow).
      </p>
      <PipelineBoard leads={leads} kampagnen={kampagnen} campaignId={campaignId} jetzt={Date.now()} lesend={!hatRolle(me.rolle, 'mitglied')} />
    </div>
  );
}
