import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { LeadgenEinstellungen } from '@/components/LeadgenEinstellungen';
import { LeadgenEreignisse } from '@/components/LeadgenEreignisse';
import { LeadgenFilter } from '@/components/LeadgenFilter';
import { hatRolle } from '@/lib/auth';
import { getDb, schema } from '@/lib/db';
import { EREIGNIS_LABEL, ladeEreignisse } from '@/lib/leadgen/ereignisse';
import { extraktionsModell } from '@/lib/leadgen/extract/openai-provider';
import { braveSchluessel } from '@/lib/leadgen/search/brave';
import { ladeRollenDefinitionen, pruefeVoraussetzungen } from '@/lib/leadgen/standard-deps';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

const datum = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });
const STATUS: Record<string, string> = { laeuft: 'Läuft', fertig: 'Fertig', fehler: 'Fehlgeschlagen', abgebrochen: 'Abgebrochen' };

export default async function LeadsGenerierenSeite() {
  const me = await erforderSeitenRolle();
  const db = getDb();
  const voraus = pruefeVoraussetzungen();
  const laeufe = db.select().from(schema.pipelineRuns).orderBy(desc(schema.pipelineRuns.id)).limit(15).all();
  const firmen = new Map(db.select({ runId: schema.lauffirmen.runId, n: sql<number>`count(*)` }).from(schema.lauffirmen).groupBy(schema.lauffirmen.runId).all().map((x) => [x.runId, x.n]));
  const ereignisse = ladeEreignisse({ nurNeue: true, limit: 20 }).map((e) => ({ ...e, text: EREIGNIS_LABEL[e.typ] }));
  const pruefFaelle = db.select({ n: sql<number>`count(*)` }).from(schema.matchReview).where(sql`${schema.matchReview.status} = 'offen'`).get()?.n ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Leads generieren</h1>
        <p className="text-sm text-slate-500">
          Firmen, Ansprechpartner und verifizierte E-Mail-Adressen aus öffentlichen Geschäftsdaten. Jeder Wert trägt seine Quelle und Konfidenz.{' '}
          {pruefFaelle > 0 && (
            <Link href="/leads-generieren/pruefung" className="text-indigo-600 hover:underline">
              {pruefFaelle} unsichere Firmen-Treffer prüfen
            </Link>
          )}
        </p>
      </div>

      {voraus.hinweise.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          <strong>Nicht alles ist eingerichtet:</strong>
          <ul className="mt-1 list-disc pl-5">
            {voraus.hinweise.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      <LeadgenEreignisse ereignisse={ereignisse} />

      {hatRolle(me.rolle, 'mitglied') ? <LeadgenFilter rollen={ladeRollenDefinitionen().map((r) => ({ key: r.key, label: r.label }))} /> : <p className="text-sm text-slate-500">Mit der Rolle „Nur lesen“ lassen sich keine Läufe starten.</p>}
      {me.rolle === 'admin' && <LeadgenEinstellungen braveGesetzt={!!braveSchluessel()} modell={extraktionsModell()} />}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold">Bisherige Läufe</h2>
        {laeufe.length === 0 ? (
          <p className="text-sm text-slate-500">Noch kein Lauf gestartet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">Lauf</th>
                <th className="px-2 py-2">Gestartet</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2 text-right">Firmen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {laeufe.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-2">
                    <Link href={`/leads-generieren/${r.id}`} className="text-indigo-600 hover:underline">
                      Lauf {r.id}{(r.filter as { refresh?: boolean }).refresh ? ' (Auffrischung)' : ''}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-slate-600">{datum.format(r.gestartetAm)}</td>
                  <td className="px-2 py-2">{STATUS[r.status] ?? r.status}</td>
                  <td className="px-2 py-2 text-right">{firmen.get(r.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
