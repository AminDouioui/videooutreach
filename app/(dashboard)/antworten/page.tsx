import Link from 'next/link';
import { LeadStatusSelect, GelesenButton } from '@/components/LeadStatusSelect';
import { gmailThreadUrl, LEAD_STATUS, LEAD_STATUS_INFO } from '@/lib/lead-status';
import { ladeAntworten, parseAntwortFilter } from '@/lib/lead-listen';

export const dynamic = 'force-dynamic';

const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });

type SP = Promise<Record<string, string | string[] | undefined>>;

function href(gelesen: string, status: string) {
  const p = new URLSearchParams();
  if (gelesen === 'alle') p.set('gelesen', 'alle');
  if (status) p.set('status', status);
  const q = p.toString();
  return q ? `/antworten?${q}` : '/antworten';
}

export default async function Antworten({ searchParams }: { searchParams: SP }) {
  const filter = parseAntwortFilter(await searchParams);
  const eintraege = ladeAntworten(filter);
  const chip = (aktiv: boolean) => `rounded-full px-3 py-1 text-xs font-medium ${aktiv ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'}`;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Antworten</h1>
      <p className="mb-4 text-sm text-slate-500">Erkannte Antworten aus allen Kampagnen, neueste zuerst. Der Inhalt der Antwort steht nur in Gmail.</p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <Link href={href('ungelesen', filter.leadStatus)} className={chip(filter.gelesen === 'ungelesen')}>
            Ungelesen
          </Link>
          <Link href={href('alle', filter.leadStatus)} className={chip(filter.gelesen === 'alle')}>
            Alle
          </Link>
        </div>
        <div className="flex flex-wrap gap-1">
          <Link href={href(filter.gelesen, '')} className={chip(!filter.leadStatus)}>
            Alle Lead-Status
          </Link>
          {LEAD_STATUS.map((s) => (
            <Link key={s} href={href(filter.gelesen, s)} className={chip(filter.leadStatus === s)}>
              {LEAD_STATUS_INFO[s].label}
            </Link>
          ))}
        </div>
        <span className="text-xs text-slate-500">{eintraege.length} Antwort{eintraege.length === 1 ? '' : 'en'}</span>
      </div>

      {eintraege.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          {filter.gelesen === 'ungelesen' ? 'Keine ungelesenen Antworten.' : 'Keine Antworten für diesen Filter.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {eintraege.map(({ lead, kampagne }) => {
            const name = [lead.anrede, lead.vorname, lead.nachname].filter(Boolean).join(' ');
            const wann = lead.antwortAt ?? lead.flowStoppAt;
            return (
              <li key={lead.id} className={`rounded-lg border bg-white p-4 ${lead.antwortGelesen ? 'border-slate-200' : 'border-indigo-300 ring-1 ring-indigo-100'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {!lead.antwortGelesen && <span className="h-2 w-2 rounded-full bg-indigo-600" title="Ungelesen" />}
                      {lead.firma}
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">Score {lead.score}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {name || 'Kein Ansprechpartner'} · {lead.email}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <Link href={`/kampagnen/${lead.campaignId}`} className="hover:underline">
                        {kampagne}
                      </Link>{' '}
                      · {wann ? zeit.format(wann) : 'Zeitpunkt unbekannt'}
                    </p>
                  </div>
                  <LeadStatusSelect leadId={lead.id} status={lead.leadStatus} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {lead.gmailThreadId && (
                    <a
                      href={gmailThreadUrl(lead.gmailThreadId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      In Gmail öffnen
                    </a>
                  )}
                  <GelesenButton leadId={lead.id} gelesen={lead.antwortGelesen} />
                  <Link href={`/leads/${lead.id}`} className="text-indigo-600 hover:underline">
                    Lead-Details
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
