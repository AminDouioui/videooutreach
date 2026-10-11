import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { LeadStatusBadge } from '@/components/Badge';
import { AutoGelesen, GelesenButton, LeadStatusSelect } from '@/components/LeadStatusSelect';
import { KiEinordnung } from '@/components/KiKomponenten';
import { ThreadAnsicht } from '@/components/ThreadAnsicht';
import { leadThreads } from '@/lib/antworten';
import { getDb, schema } from '@/lib/db';
import { kiAktiv } from '@/lib/ki';
import { KI_KATEGORIE_LABEL, type KiKategorie } from '@/lib/ki-kategorien';
import { gmailThreadUrl, LEAD_STATUS, LEAD_STATUS_INFO } from '@/lib/lead-status';
import { ladeAntworten, parseAntwortFilter } from '@/lib/lead-listen';

export const dynamic = 'force-dynamic';

const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });

type SP = Promise<Record<string, string | string[] | undefined>>;

function href(gelesen: string, status: string, lead?: number) {
  const p = new URLSearchParams();
  if (gelesen === 'alle') p.set('gelesen', 'alle');
  if (status) p.set('status', status);
  if (lead) p.set('lead', String(lead));
  const q = p.toString();
  return q ? `/antworten?${q}` : '/antworten';
}

export default async function Antworten({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filter = parseAntwortFilter(sp);
  const eintraege = ladeAntworten(filter);
  const leadParam = Number(Array.isArray(sp.lead) ? sp.lead[0] : sp.lead);
  const auswahl = Number.isInteger(leadParam) && leadParam > 0 ? getDb().select({ lead: schema.leads, kampagne: schema.campaigns.name }).from(schema.leads).innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId)).where(eq(schema.leads.id, leadParam)).get() : undefined;
  const chip = (aktiv: boolean) => `rounded-full px-3 py-1 text-xs font-medium ${aktiv ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'}`;
  const ki = kiAktiv();
  const name = (l: { anrede: string | null; vorname: string | null; nachname: string | null }) => [l.anrede, l.vorname, l.nachname].filter(Boolean).join(' ');

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Antworten</h1>
      <p className="mb-4 text-sm text-slate-500">
        Erkannte Antworten aus allen Kampagnen, neueste zuerst. Mit Lesezugriff auf das Postfach (Einstellungen → Postfächer) erscheint der Verlauf direkt hier und
        Antworten lassen sich in der App senden; sonst steht der Inhalt nur in Gmail.
      </p>

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        {/* Liste (mobil: nur ohne Auswahl) */}
        <section className={`${auswahl ? 'hidden lg:block' : ''} min-w-0`} aria-label="Antwortliste">
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1">
              <Link href={href('ungelesen', filter.leadStatus, auswahl?.lead.id)} className={chip(filter.gelesen === 'ungelesen')}>
                Ungelesen
              </Link>
              <Link href={href('alle', filter.leadStatus, auswahl?.lead.id)} className={chip(filter.gelesen === 'alle')}>
                Alle
              </Link>
              <span className="ml-auto text-xs text-slate-500">
                {eintraege.length} Antwort{eintraege.length === 1 ? '' : 'en'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Link href={href(filter.gelesen, '', auswahl?.lead.id)} className={chip(!filter.leadStatus)}>
                Alle Lead-Status
              </Link>
              {LEAD_STATUS.map((s) => (
                <Link key={s} href={href(filter.gelesen, s, auswahl?.lead.id)} className={chip(filter.leadStatus === s)}>
                  {LEAD_STATUS_INFO[s].label}
                </Link>
              ))}
            </div>
          </div>

          {eintraege.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              {filter.gelesen === 'ungelesen' ? 'Keine ungelesenen Antworten.' : 'Keine Antworten für diesen Filter.'}
            </div>
          ) : (
            <ul className="space-y-2 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto lg:pr-1">
              {eintraege.map(({ lead, kampagne }) => {
                const wann = lead.antwortAt ?? lead.flowStoppAt;
                const aktiv = auswahl?.lead.id === lead.id;
                return (
                  <li key={lead.id}>
                    <Link
                      href={href(filter.gelesen, filter.leadStatus, lead.id)}
                      aria-current={aktiv ? 'true' : undefined}
                      className={`block rounded-lg border bg-white p-3 hover:bg-slate-50 ${aktiv ? 'border-indigo-500 ring-2 ring-indigo-200' : lead.antwortGelesen ? 'border-slate-200' : 'border-indigo-300 ring-1 ring-indigo-100'}`}
                    >
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {!lead.antwortGelesen && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" title="Ungelesen" />}
                        <span className="min-w-0 break-words">{lead.firma}</span>
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">Score {lead.score}</span>
                      </p>
                      <p className="mt-0.5 break-words text-sm text-slate-600">
                        {name(lead) || 'Kein Ansprechpartner'} · {lead.email}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="min-w-0 break-words">{kampagne}</span>· {wann ? zeit.format(wann) : 'Zeitpunkt unbekannt'}
                        <LeadStatusBadge status={lead.leadStatus} />
                        {ki && lead.kiEinordnung && (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900" title="KI-Einordnung">
                            KI: {KI_KATEGORIE_LABEL[lead.kiEinordnung.kategorie as KiKategorie] ?? lead.kiEinordnung.kategorie}
                          </span>
                        )}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Detail (mobil: eigene Ansicht) */}
        <section className={`${auswahl ? '' : 'hidden lg:block'} min-w-0`} aria-label="Verlauf">
          {!auswahl ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Antwort in der Liste auswählen, um den Verlauf zu sehen.</div>
          ) : (
            <Detail lead={auswahl.lead} kampagne={auswahl.kampagne} zurueck={href(filter.gelesen, filter.leadStatus)} ki={ki} />
          )}
        </section>
      </div>
    </div>
  );
}

function Detail({ lead, kampagne, zurueck, ki }: { lead: typeof schema.leads.$inferSelect; kampagne: string; zurueck: string; ki: boolean }) {
  const t = leadThreads(lead);
  const gmailUrl = lead.gmailThreadId ? gmailThreadUrl(lead.antwortThreadId ?? lead.gmailThreadId) : null;
  const personName = [lead.anrede, lead.vorname, lead.nachname].filter(Boolean).join(' ');
  const wann = lead.antwortAt ?? lead.flowStoppAt;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <AutoGelesen key={lead.id} leadId={lead.id} gelesen={lead.antwortGelesen} />
      <Link href={zurueck} className="mb-3 inline-block text-sm text-indigo-600 hover:underline lg:hidden">
        ← Zurück zur Liste
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold">{lead.firma}</h2>
          <p className="mt-0.5 break-words text-sm text-slate-600">
            {personName || 'Kein Ansprechpartner'} · {lead.email}
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
      <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 text-sm">
        <GelesenButton leadId={lead.id} gelesen={lead.antwortGelesen} />
        <Link href={`/leads/${lead.id}`} className="text-indigo-600 hover:underline">
          Lead-Details
        </Link>
        {gmailUrl && (
          <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700">
            In Gmail öffnen
          </a>
        )}
      </div>
      {ki && (
        <div className="mt-3">
          <KiEinordnung key={lead.id} aktiv leadId={lead.id} einordnung={lead.kiEinordnung ?? null} />
        </div>
      )}
      <div className="mt-3">
        {t.lesezugriff && t.postfach ? (
          <ThreadAnsicht leadId={lead.id} threads={t.threads} start={t.start} antwortenErlaubt postfachEmail={t.postfach.email} gmailUrl={gmailUrl} kiAktiv={ki} />
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Verlauf nur in Gmail</p>
            <p className="mt-1">
              {t.postfach
                ? `Für das Postfach ${t.postfach.email} ist der Lesezugriff nicht erteilt.`
                : 'Diesem Lead ist kein Postfach zugeordnet.'}{' '}
              {t.postfach && (
                <>
                  Unter{' '}
                  <Link href="/einstellungen" className="font-medium underline">
                    Einstellungen → Postfächer
                  </Link>{' '}
                  „Lesezugriff erteilen“, dann erscheint der Verlauf hier und Antworten gehen direkt aus der App.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
