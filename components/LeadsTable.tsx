'use client';

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
  score: number;
};

type SortKey = 'firma' | 'ansprechpartner' | 'email' | 'renderStatus' | 'sendStatus' | 'score';
type FilterKey = 'alle' | 'nicht_gesendet' | 'fehler';

const SPALTEN: { key: SortKey; label: string }[] = [
  { key: 'firma', label: 'Firma' },
  { key: 'ansprechpartner', label: 'Ansprechpartner' },
  { key: 'email', label: 'E-Mail' },
  { key: 'renderStatus', label: 'Render-Status' },
  { key: 'sendStatus', label: 'Versand-Status' },
  { key: 'score', label: 'Score' },
];

const FILTER: { key: FilterKey; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'nicht_gesendet', label: 'Nicht gesendet' },
  { key: 'fehler', label: 'Fehler' },
];

export function LeadsTable({ leads, baseUrl }: { leads: LeadRow[]; baseUrl: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false); // Standard: Score absteigend
  const [filter, setFilter] = useState<FilterKey>('alle');
  const [suche, setSuche] = useState('');

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const gefiltert = leads.filter((l) => {
      if (q && !l.firma.toLowerCase().includes(q) && !l.email.toLowerCase().includes(q)) return false;
      if (filter === 'nicht_gesendet') return l.sendStatus === 'nicht_gesendet';
      if (filter === 'fehler') return l.renderStatus === 'fehler' || l.sendStatus === 'fehler';
      return true;
    });
    const dir = sortAsc ? 1 : -1;
    return [...gefiltert].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de');
      return c * dir || a.firma.localeCompare(b.firma, 'de');
    });
  }, [leads, sortKey, sortAsc, filter, suche]);

  function sortieren(key: SortKey) {
    if (key === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key !== 'score');
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
        <div className="flex gap-1">
          {FILTER.map((f) => (
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
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {SPALTEN.slice(0, 3).map((s) => (
                <Kopf key={s.key} s={s} aktiv={sortKey === s.key} asc={sortAsc} onClick={() => sortieren(s.key)} />
              ))}
              <th className="px-3 py-2">Link</th>
              {SPALTEN.slice(3).map((s) => (
                <Kopf key={s.key} s={s} aktiv={sortKey === s.key} asc={sortAsc} onClick={() => sortieren(s.key)} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sichtbar.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{l.firma}</td>
                <td className="px-3 py-2">{l.ansprechpartner || '–'}</td>
                <td className="px-3 py-2">{l.email}</td>
                <td className="px-3 py-2">
                  <span className="mr-2 font-mono text-xs text-slate-500">{l.slug}</span>
                  <CopyButton text={`${baseUrl}/v/${l.slug}`} label="Link kopieren" />
                </td>
                <td className="px-3 py-2">
                  <Badge status={l.renderStatus} />
                </td>
                <td className="px-3 py-2">
                  <Badge status={l.sendStatus} />
                </td>
                <td className="px-3 py-2 text-right">{l.score}</td>
              </tr>
            ))}
            {sichtbar.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
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

function Kopf({ s, aktiv, asc, onClick }: { s: { key: SortKey; label: string }; aktiv: boolean; asc: boolean; onClick: () => void }) {
  return (
    <th className="px-3 py-2">
      <button onClick={onClick} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900">
        {s.label}
        <span aria-hidden>{aktiv ? (asc ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}
