import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { Badge, LeadStatusBadge } from '@/components/Badge';
import { getDb, schema } from '@/lib/db';
import { LEAD_STATUS, LEAD_STATUS_INFO } from '@/lib/lead-status';
import { ladeLeadsSeite, LEADS_PRO_SEITE, parseLeadsFilter, SEND_STATUS_WERTE, type LeadsFilter } from '@/lib/lead-listen';

export const dynamic = 'force-dynamic';

const datum = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });
const SEND_LABEL: Record<string, string> = { nicht_gesendet: 'Nicht gesendet', geplant: 'Geplant', gesendet: 'Gesendet', fehler: 'Fehler', uebersprungen: 'Übersprungen' };
const feld = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

function query(f: LeadsFilter, patch: Partial<LeadsFilter> = {}): string {
  const x = { ...f, ...patch };
  const p = new URLSearchParams();
  if (x.q) p.set('q', x.q);
  if (x.kampagne !== null) p.set('kampagne', String(x.kampagne));
  if (x.leadStatus) p.set('status', x.leadStatus);
  if (x.sendStatus) p.set('versand', x.sendStatus);
  if (x.beantwortet) p.set('beantwortet', x.beantwortet);
  if (x.sort !== 'score') p.set('sort', x.sort);
  if (x.dir !== 'desc') p.set('dir', x.dir);
  if (x.seite > 1) p.set('seite', String(x.seite));
  const s = p.toString();
  return s ? `/leads?${s}` : '/leads';
}

export default async function LeadsSeite({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseLeadsFilter(await searchParams);
  const { zeilen, total, seiten, seite } = ladeLeadsSeite(f);
  const kampagnen = getDb().select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).orderBy(asc(schema.campaigns.name)).all();

  function sortLink(sort: LeadsFilter['sort'], label: string) {
    const aktiv = f.sort === sort;
    return (
      <Link href={query(f, { sort, dir: aktiv && f.dir === 'desc' ? 'asc' : 'desc', seite: 1 })} className="inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wide hover:text-slate-900">
        {label}
        <span aria-hidden className="inline-block w-3">
          {aktiv ? (f.dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </Link>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Leads</h1>
      <p className="mb-4 text-sm text-slate-500">Alle Leads aller Kampagnen.</p>

      <form method="get" action="/leads" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="search" name="q" defaultValue={f.q} placeholder="Suche nach Firma, Name oder E-Mail" className={`${feld} w-64`} />
        <select name="kampagne" defaultValue={f.kampagne ?? ''} aria-label="Kampagne" className={feld}>
          <option value="">Alle Kampagnen</option>
          {kampagnen.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={f.leadStatus} aria-label="Lead-Status" className={feld}>
          <option value="">Alle Lead-Status</option>
          {LEAD_STATUS.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_INFO[s].label}
            </option>
          ))}
        </select>
        <select name="versand" defaultValue={f.sendStatus} aria-label="Versandstatus" className={feld}>
          <option value="">Alle Versandstatus</option>
          {SEND_STATUS_WERTE.map((s) => (
            <option key={s} value={s}>
              {SEND_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="beantwortet" defaultValue={f.beantwortet} aria-label="Beantwortet" className={feld}>
          <option value="">Beantwortet: egal</option>
          <option value="ja">Beantwortet</option>
          <option value="nein">Nicht beantwortet</option>
        </select>
        <input type="hidden" name="sort" value={f.sort} />
        <input type="hidden" name="dir" value={f.dir} />
        <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Filtern
        </button>
        <Link href="/leads" className="text-sm text-slate-500 hover:underline">
          Zurücksetzen
        </Link>
        <span className="text-xs text-slate-500">{total} Leads</span>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Firma</th>
              <th className="px-3 py-2">Ansprechpartner</th>
              <th className="px-3 py-2">E-Mail</th>
              <th className="px-3 py-2">Kampagne</th>
              <th className="px-3 py-2">Versand</th>
              <th className="px-3 py-2">Lead-Status</th>
              <th className="px-3 py-2">Antwort</th>
              <th className="px-3 py-2">{sortLink('gesendet', 'Gesendet am')}</th>
              <th className="px-3 py-2">{sortLink('importiert', 'Importiert')}</th>
              <th className="px-3 py-2 text-right">{sortLink('score', 'Score')}</th>
              <th className="px-3 py-2">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {zeilen.map(({ lead: l, kampagne }) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{l.firma}</td>
                <td className="px-3 py-2">{[l.vorname, l.nachname].filter(Boolean).join(' ') || '–'}</td>
                <td className="px-3 py-2">{l.email}</td>
                <td className="px-3 py-2">
                  <Link href={`/kampagnen/${l.campaignId}`} className="text-slate-600 hover:underline">
                    {kampagne}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Badge status={l.sendStatus} />
                </td>
                <td className="px-3 py-2">
                  <LeadStatusBadge status={l.leadStatus} />
                </td>
                <td className="px-3 py-2">{l.flowStopp === 'beantwortet' ? <Badge status="beantwortet" /> : <span className="text-slate-400">–</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{l.sentAt ? datum.format(l.sentAt) : '–'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{datum.format(l.createdAt)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{l.score}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/leads/${l.id}`} className="text-indigo-600 hover:underline">
                    Details
                  </Link>
                </td>
              </tr>
            ))}
            {zeilen.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                  Keine Leads für diesen Filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {seiten > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Seiten">
          {seite > 1 ? (
            <Link href={query(f, { seite: seite - 1 })} className="rounded-md border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50">
              Zurück
            </Link>
          ) : (
            <span className="rounded-md border border-slate-200 px-3 py-1 text-slate-400">Zurück</span>
          )}
          <span className="text-slate-600">
            Seite {seite} von {seiten} ({LEADS_PRO_SEITE} pro Seite)
          </span>
          {seite < seiten ? (
            <Link href={query(f, { seite: seite + 1 })} className="rounded-md border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50">
              Weiter
            </Link>
          ) : (
            <span className="rounded-md border border-slate-200 px-3 py-1 text-slate-400">Weiter</span>
          )}
        </nav>
      )}
    </div>
  );
}
