import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { ladeAbsender } from '@/lib/absender';
import { istBounceFehler } from '@/lib/bounce-schutz';
import { Kachel, TagesDiagramm } from '@/components/AnalyseDiagramme';
import { KampagnenTabelle, type KampagnenZeile } from '@/components/KampagnenTabelle';
import { ladeUebersicht } from '@/lib/analyse';
import { ladeKennzahlen } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';
import { hatRolle } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function KampagnenUebersicht() {
  const me = await erforderSeitenRolle();
  const kampagnen = getDb().select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).all();
  const kennzahlen = ladeKennzahlen();
  const uebersicht = ladeUebersicht();
  const u = uebersicht.kennzahlen;
  const prozent = (r: number) => `${(r * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
  const zeilen: KampagnenZeile[] = kampagnen.map((k) => {
    const z = kennzahlen.get(k.id);
    return {
      id: k.id,
      name: k.name,
      status: k.status,
      mitVideo: k.mitVideo,
      erstellt: k.createdAt.getTime(),
      leads: z?.leads ?? 0,
      gerendert: z?.gerendert ?? 0,
      gesendet: z?.gesendet ?? 0,
      antworten: z?.antworten ?? 0,
      antwortRate: z && z.gesendet > 0 ? z.antworten / z.gesendet : null,
      seitenaufrufe: z?.seitenaufrufe ?? 0,
      videostarts: z?.videostarts ?? 0,
      sehdauer: z?.sehdauer ?? null,
      terminKlicks: z?.terminKlicks ?? 0,
      abmeldungen: z?.abmeldungen ?? 0,
    };
  });

  // Hinweise des Bounce-Schutzes: automatisch pausierte Kampagnen und Postfächer
  const pausiert = kampagnen.filter((k) => k.status === 'pausiert' && k.pausiertGrund);
  const bouncePostfaecher = ladeAbsender().filter((a) => !a.aktiv && istBounceFehler(a.fehler));

  return (
    <div>
      {(pausiert.length > 0 || bouncePostfaecher.length > 0) && (
        <div role="alert" className="mb-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {pausiert.map((k) => (
            <p key={`k${k.id}`}>
              <strong>Kampagne pausiert:</strong>{' '}
              <Link href={`/kampagnen/${k.id}`} className="underline">
                {k.name}
              </Link>{' '}
              – {k.pausiertGrund}
            </p>
          ))}
          {bouncePostfaecher.map((a) => (
            <p key={`p${a.id}`}>
              <strong>Postfach pausiert:</strong>{' '}
              <Link href="/einstellungen" className="underline">
                {a.email}
              </Link>{' '}
              – {a.fehler}
            </p>
          ))}
        </div>
      )}
      <section className="mb-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Kachel label="Gesendet heute" wert={u.gesendetHeute} />
          <Kachel label="Gesendet 7 Tage" wert={u.gesendet7Tage} />
          <Kachel label="Gesendet gesamt" wert={u.gesendetGesamt} />
          <Kachel label="Antwortrate" wert={prozent(u.antwortRate)} hinweis={`${u.antworten} Antworten`} />
          <Kachel label="Video-Ansichtsrate" wert={prozent(u.angesehenRate)} hinweis={`${u.angesehen} Leads`} />
          <Kachel label="Termin-Klicks" wert={u.terminKlicks} hinweis={prozent(u.terminRate)} />
          <Kachel label="Ungelesene Antworten" wert={uebersicht.ungelesen} hinweis="Zum Postfach" href="/antworten" />
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Letzte 14 Tage</h2>
          <TagesDiagramm tage={uebersicht.tage} />
        </div>
      </section>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kampagnen</h1>
        {hatRolle(me.rolle, 'mitglied') && (
          <Link href="/kampagnen/neu" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Neue Kampagne
          </Link>
        )}
      </div>

      {kampagnen.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Noch keine Kampagne vorhanden. Legen Sie die erste Kampagne an.
        </div>
      ) : (
        <KampagnenTabelle kampagnen={zeilen} />
      )}
    </div>
  );
}
