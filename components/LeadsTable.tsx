'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { LEAD_STATUS, LEAD_STATUS_INFO } from '@/lib/lead-status';
import { Badge, LeadStatusBadge } from './Badge';
import { CopyButton } from './CopyButton';

export type LeadRow = {
  id: number;
  firma: string;
  ansprechpartner: string;
  email: string;
  slug: string;
  renderStatus: string;
  sendStatus: string;
  /** Lead-Status (offen, interessiert …) */
  leadStatus: string;
  /** Unix-ms oder null */
  sentAt: number | null;
  /** Nicht-Bot-Seitenaufrufe */
  aufrufe: number;
  videostarts: number;
  /** höchster Fortschritt in % */
  maxProgress: number;
  terminKlicks: number;
  oeffnungen: number;
  score: number;
  /** Variante der Erstmail (A, B …) oder null */
  variante: string | null;
  /** Absender-Postfach (E-Mail) der Erstmail oder null */
  postfach: string | null;
  /** Bisher gesendete Mails des Flows (Erstmail + Follow-ups) */
  flowSchritt: number;
  /** Flow beendet: beantwortet, bounce, abgemeldet */
  flowStopp: string | null;
  /** Weiterer Kontakt einer Firma, die schon einen Lead in der Kampagne hat */
  firmenDuplikat: boolean;
  /** Als Firmen-Duplikat vom Versand ausgeschlossen */
  duplikatAusgeschlossen: boolean;
};

type SortKey = 'firma' | 'ansprechpartner' | 'email' | 'renderStatus' | 'sendStatus' | 'leadStatus' | 'variante' | 'postfach' | 'flowSchritt' | 'sentAt' | 'aufrufe' | 'maxProgress' | 'terminKlicks' | 'oeffnungen' | 'score';
type FilterKey = 'alle' | 'mit_play' | 'nicht_gesendet' | 'beantwortet' | 'duplikate' | 'fehler' | 'termin';

const FILTER: { key: FilterKey; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'mit_play', label: 'Mit Play' },
  { key: 'nicht_gesendet', label: 'Nicht gesendet' },
  { key: 'beantwortet', label: 'Beantwortet' },
  { key: 'duplikate', label: 'Firmen-Duplikate' },
  { key: 'fehler', label: 'Fehler' },
  { key: 'termin', label: 'Termin-Klick' },
];

const datumFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });

export function LeadsTable({
  leads,
  baseUrl,
  campaignId,
  trackingPixel = false,
  mitVideo = true,
  followupSchritte = 0,
  abTest = false,
  mehrerePostfaecher = false,
}: {
  leads: LeadRow[];
  baseUrl: string;
  campaignId?: number;
  trackingPixel?: boolean;
  /** false = Text-Kampagne: keine Render-, Video- und Link-Spalten */
  mitVideo?: boolean;
  /** Anzahl Follow-ups im Flow (0 = keine Flow-Spalte) */
  followupSchritte?: number;
  /** Mehr als eine Variante: Spalte „Variante“ anzeigen */
  abTest?: boolean;
  /** Mehr als ein Postfach: Spalte „Postfach“ anzeigen */
  mehrerePostfaecher?: boolean;
}) {
  const flowGesamt = 1 + followupSchritte;
  const filter_ = FILTER.filter((f) => mitVideo || (f.key !== 'mit_play' && f.key !== 'termin'));
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false); // Standard: Score absteigend
  const [filter, setFilter] = useState<FilterKey>('alle');
  const [suche, setSuche] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ohneDuplikate, setOhneDuplikate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const router = useRouter();
  const duplikate = leads.filter((l) => l.firmenDuplikat);
  const offeneDuplikate = duplikate.filter((l) => !l.duplikatAusgeschlossen && l.sendStatus !== 'gesendet' && l.sendStatus !== 'uebersprungen').length;
  const ausgeschlossen = leads.filter((l) => l.duplikatAusgeschlossen).length;

  async function duplikatAktion(action: 'ausschliessen' | 'aufheben') {
    if (campaignId === undefined) return;
    if (
      action === 'ausschliessen' &&
      !confirm(`${offeneDuplikate} weitere Kontakt(e) bereits vorhandener Firmen nicht anschreiben? Je Firma bleibt der zuerst angeschriebene bzw. zuerst importierte Kontakt. Lässt sich rückgängig machen.`)
    )
      return;
    setBusy(true);
    setMeldung(null);
    const res = await fetch(`/api/campaigns/${campaignId}/firmen-duplikate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const data = (await res.json().catch(() => ({}))) as { anzahl?: number; error?: string };
    setMeldung(res.ok ? (action === 'ausschliessen' ? `${data.anzahl} Duplikat(e) ausgeschlossen.` : `${data.anzahl} Duplikat(e) wieder freigegeben.`) : (data.error ?? 'Aktion fehlgeschlagen'));
    setBusy(false);
    router.refresh();
  }

  const spalten: { key: SortKey; label: string; rechts?: boolean }[] = [
    { key: 'firma', label: 'Firma' },
    { key: 'ansprechpartner', label: 'Ansprechpartner' },
    { key: 'email', label: 'E-Mail' },
    ...(mitVideo ? [{ key: 'renderStatus' as SortKey, label: 'Render-Status' }] : []),
    { key: 'sendStatus', label: 'Versand-Status' },
    { key: 'leadStatus', label: 'Lead-Status' },
    ...(followupSchritte > 0 ? [{ key: 'flowSchritt' as SortKey, label: 'Flow' }] : []),
    ...(abTest ? [{ key: 'variante' as SortKey, label: 'Variante' }] : []),
    ...(mehrerePostfaecher ? [{ key: 'postfach' as SortKey, label: 'Postfach' }] : []),
    { key: 'sentAt', label: 'Gesendet am' },
    ...(mitVideo
      ? [
          { key: 'aufrufe' as SortKey, label: 'Aufrufe', rechts: true },
          { key: 'maxProgress' as SortKey, label: 'Angeschaut', rechts: true },
          { key: 'terminKlicks' as SortKey, label: 'Termin-Klick' },
        ]
      : []),
    ...(trackingPixel ? [{ key: 'oeffnungen' as SortKey, label: 'Geöffnet (unzuverlässig)', rechts: true }] : []),
    { key: 'score', label: 'Score', rechts: true },
  ];

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const gefiltert = leads.filter((l) => {
      if (q && !l.firma.toLowerCase().includes(q) && !l.email.toLowerCase().includes(q) && !l.ansprechpartner.toLowerCase().includes(q)) return false;
      if (ohneDuplikate && l.firmenDuplikat) return false;
      if (statusFilter && l.leadStatus !== statusFilter) return false;
      if (filter === 'duplikate') return l.firmenDuplikat;
      if (filter === 'mit_play') return l.videostarts > 0;
      if (filter === 'nicht_gesendet') return l.sendStatus === 'nicht_gesendet';
      if (filter === 'beantwortet') return l.flowStopp === 'beantwortet';
      if (filter === 'fehler') return l.renderStatus === 'fehler' || l.sendStatus === 'fehler';
      if (filter === 'termin') return l.terminKlicks > 0;
      return true;
    });
    const dir = sortAsc ? 1 : -1;
    return [...gefiltert].sort((a, b) => {
      const va = a[sortKey] ?? -1;
      const vb = b[sortKey] ?? -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de');
      return c * dir || a.firma.localeCompare(b.firma, 'de');
    });
  }, [leads, sortKey, sortAsc, filter, suche, ohneDuplikate, statusFilter]);

  function sortieren(key: SortKey) {
    if (key === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === 'firma' || key === 'ansprechpartner' || key === 'email' || key === 'renderStatus' || key === 'sendStatus' || key === 'leadStatus');
    }
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        Diese Kampagne enthält noch keine Leads. Importieren Sie eine Excel- oder CSV-Liste.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Suche nach Firma, Name oder E-Mail"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        />
        <div className="flex flex-wrap gap-1">
          {filter_.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Nach Lead-Status filtern"
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        >
          <option value="">Alle Lead-Status</option>
          {LEAD_STATUS.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_INFO[s].label}
            </option>
          ))}
        </select>
        {duplikate.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={ohneDuplikate} onChange={(e) => setOhneDuplikate(e.target.checked)} />
            Firmen-Duplikate ausblenden ({duplikate.length})
          </label>
        )}
        <span className="text-xs text-slate-500">
          {sichtbar.length} von {leads.length} Leads
        </span>
        {campaignId !== undefined && (
          <a
            href={`/api/campaigns/${campaignId}/export.csv`}
            className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            CSV-Export
          </a>
        )}
      </div>

      {campaignId !== undefined && (offeneDuplikate > 0 || ausgeschlossen > 0 || meldung) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {offeneDuplikate > 0 && (
            <>
              <span>
                {offeneDuplikate} weitere Kontakt(e) von Firmen, die schon in der Kampagne sind.
              </span>
              <button onClick={() => duplikatAktion('ausschliessen')} disabled={busy} className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                Duplikate nicht anschreiben
              </button>
            </>
          )}
          {ausgeschlossen > 0 && (
            <>
              <span>{ausgeschlossen} Firmen-Duplikat(e) ausgeschlossen.</span>
              <button onClick={() => duplikatAktion('aufheben')} disabled={busy} className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60">
                Ausschluss aufheben
              </button>
            </>
          )}
          {meldung && <span className="text-xs">{meldung}</span>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {spalten.map((s) => (
                <Kopf key={s.key} s={s} aktiv={sortKey === s.key} asc={sortAsc} onClick={() => sortieren(s.key)} />
              ))}
              {mitVideo && <th className="px-3 py-2">Link</th>}
              <th className="px-3 py-2">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sichtbar.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">
                  {l.firma}
                  {l.firmenDuplikat && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800" title="Weiterer Kontakt einer Firma, die schon in der Kampagne ist">
                      Duplikat
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{l.ansprechpartner || '–'}</td>
                <td className="px-3 py-2">{l.email}</td>
                {mitVideo && (
                  <td className="px-3 py-2">
                    <Badge status={l.renderStatus} />
                  </td>
                )}
                <td className="px-3 py-2">
                  <Badge status={l.sendStatus} />
                </td>
                <td className="px-3 py-2">
                  <LeadStatusBadge status={l.leadStatus} />
                </td>
                {followupSchritte > 0 && (
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="tabular-nums text-slate-600">
                      {l.flowSchritt}/{flowGesamt}
                    </span>
                    {l.flowStopp && (
                      <span className="ml-1.5">
                        <Badge status={l.flowStopp} />
                      </span>
                    )}
                  </td>
                )}
                {abTest && (
                  <td className="px-3 py-2">
                    {l.variante ? <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700">{l.variante}</span> : <span className="text-slate-400">–</span>}
                  </td>
                )}
                {mehrerePostfaecher && <td className="whitespace-nowrap px-3 py-2 text-slate-600">{l.postfach ?? '–'}</td>}
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{l.sentAt ? datumFormat.format(l.sentAt) : '–'}</td>
                {mitVideo && (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums">{l.aufrufe}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.videostarts > 0 ? `${l.maxProgress} %` : '–'}</td>
                    <td className="px-3 py-2">
                      {l.terminKlicks > 0 ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Ja</span> : <span className="text-slate-400">–</span>}
                    </td>
                  </>
                )}
                {trackingPixel && <td className="px-3 py-2 text-right tabular-nums text-slate-500">{l.oeffnungen}</td>}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{l.score}</td>
                {mitVideo && (
                  <td className="whitespace-nowrap px-3 py-2">
                    <CopyButton text={`${baseUrl.replace(/\/$/, '')}/v/${l.slug}`} label="Link kopieren" />
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/leads/${l.id}`} className="text-indigo-600 hover:underline">
                    Details
                  </Link>
                </td>
              </tr>
            ))}
            {sichtbar.length === 0 && (
              <tr>
                <td colSpan={spalten.length + (mitVideo ? 2 : 1)} className="px-3 py-6 text-center text-slate-500">
                  Keine Leads für diesen Filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kopf({ s, aktiv, asc, onClick }: { s: { key: SortKey; label: string; rechts?: boolean }; aktiv: boolean; asc: boolean; onClick: () => void }) {
  return (
    <th className={`px-3 py-2 ${s.rechts ? 'text-right' : ''}`} aria-sort={aktiv ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button onClick={onClick} className="inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wide hover:text-slate-900">
        {s.label}
        <span aria-hidden className="inline-block w-3">
          {aktiv ? (asc ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}
