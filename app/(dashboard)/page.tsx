import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { KampagnenTabelle, type KampagnenZeile } from '@/components/KampagnenTabelle';
import { ladeKennzahlen } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function KampagnenUebersicht() {
  const kampagnen = getDb().select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).all();
  const kennzahlen = ladeKennzahlen();
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
      seitenaufrufe: z?.seitenaufrufe ?? 0,
      videostarts: z?.videostarts ?? 0,
      sehdauer: z?.sehdauer ?? null,
      terminKlicks: z?.terminKlicks ?? 0,
      abmeldungen: z?.abmeldungen ?? 0,
    };
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kampagnen</h1>
        <Link href="/kampagnen/neu" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neue Kampagne
        </Link>
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
