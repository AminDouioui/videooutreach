import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { Badge } from '@/components/Badge';
import { ladeKennzahlen } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function KampagnenUebersicht() {
  const kampagnen = getDb().select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).all();
  const kennzahlen = ladeKennzahlen();

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
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Kampagne</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right">Gerendert</th>
                <th className="px-3 py-2 text-right">Gesendet</th>
                <th className="px-3 py-2 text-right">Seitenaufrufe</th>
                <th className="px-3 py-2 text-right">Videostarts</th>
                <th className="px-3 py-2 text-right">Ø Sehdauer</th>
                <th className="px-3 py-2 text-right">Termin-Klicks</th>
                <th className="px-3 py-2 text-right">Abmeldungen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {kampagnen.map((k) => {
                const z = kennzahlen.get(k.id);
                return (
                  <tr key={k.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link href={`/kampagnen/${k.id}`} className="font-medium text-indigo-600 hover:underline">
                        {k.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge status={k.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{z?.leads ?? 0}</td>
                    <td className="px-3 py-2 text-right">{z?.gerendert ?? 0}</td>
                    <td className="px-3 py-2 text-right">{z?.gesendet ?? 0}</td>
                    <td className="px-3 py-2 text-right">{z?.seitenaufrufe ?? 0}</td>
                    <td className="px-3 py-2 text-right">{z?.videostarts ?? 0}</td>
                    <td className="px-3 py-2 text-right">{z?.sehdauer != null ? `${z.sehdauer} %` : '–'}</td>
                    <td className="px-3 py-2 text-right">{z?.terminKlicks ?? 0}</td>
                    <td className="px-3 py-2 text-right">{z?.abmeldungen ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
