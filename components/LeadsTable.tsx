'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from './Badge';
import { CopyButton } from './CopyButton';

export type LeadRow = {
  id: number;
  firma: string;
  ansprechpartner: string;
  email: string;
  slug: string;
  renderStatus: string;
  sendStatus: string;
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
  /** Bisher gesendete Mails des Flows (Erstmail + Follow-ups) */
  flowSchritt: number;
  /** Flow beendet: beantwortet, bounce, abgemeldet */
  flowStopp: string | null;
};

type SortKey = 'firma' | 'ansprechpartner' | 'email' | 'renderStatus' | 'sendStatus' | 'flowSchritt' | 'sentAt' | 'aufrufe' | 'maxProgress' | 'terminKlicks' | 'oeffnungen' | 'score';
type FilterKey = 'alle' | 'mit_play' | 'nicht_gesendet' | 'beantwortet' | 'fehler' | 'termin';

const FILTER: { key: FilterKey; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'mit_play', label: 'Mit Play' },
  { key: 'nicht_gesendet', label: 'Nicht gesendet' },
  { key: 'beantwortet', label: 'Beantwortet' },
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
}: {
  leads: LeadRow[];
  baseUrl: string;
  campaignId?: number;
  trackingPixel?: boolean;
  /** false = Text-Kampagne: keine Render-, Video- und Link-Spalten */
  mitVideo?: boolean;
  /** Anzahl Follow-ups im Flow (0 = keine Flow-Spalte) */
  followupSchritte?: number;
}) {
  const flowGesamt = 1 + followupSchritte;
  const filter_ = FILTER.filter((f) => mitVideo || (f.key !== 'mit_play' && f.key !== 'termin'));
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false); // Standard: Score absteigend
  const [filter, setFilter] = useState<FilterKey>('alle');
  const [suche, setSuche] = useState('');

  const spalten: { key: SortKey; label: string; rechts?: boolean }[] = [
    { key: 'firma', label: 'Firma' },
    { key: 'ansprechpartner', label: 'Ansprechpartner' },
    { key: 'email', label: 'E-Mail' },
    ...(mitVideo ? [{ key: 'renderStatus' as SortKey, label: 'Render-Status' }] : []),
    { key: 'sendStatus', label: 'Versand-Status' },
    ...(followupSchritte > 0 ? [{ key: 'flowSchritt' as SortKey, label: 'Flow' }] : []),
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
      if (q && !l.firma.toLowerCase().includes(q) && !l.email.toLowerCase().includes(q)) return false;
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
  }, [leads, sortKey, sortAsc, filter, suche]);

  function sortieren(key: SortKey) {
    if (key === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === 'firma' || key === 'ansprechpartner' || key === 'email' || key === 'renderStatus' || key === 'sendStatus');
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
          placeholder="Suche nach Firma oder E-Mail"
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
                <td className="px-3 py-2 font-medium">{l.firma}</td>
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
