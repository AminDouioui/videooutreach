'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from './Badge';
import { FilterChips, passt, SortKopf, Suche, useSortierung } from './Tabelle';

export type KampagnenZeile = {
  id: number;
  name: string;
  status: string;
  mitVideo: boolean;
  /** Unix-ms */
  erstellt: number;
  leads: number;
  gerendert: number;
  gesendet: number;
  antworten: number;
  /** Antworten / gesendet (0–1), null ohne Versand */
  antwortRate: number | null;
  seitenaufrufe: number;
  videostarts: number;
  sehdauer: number | null;
  terminKlicks: number;
  abmeldungen: number;
};

type Spalte = Exclude<keyof KampagnenZeile, 'id' | 'mitVideo'>;
type Filter = 'alle' | 'aktiv' | 'video' | 'text' | 'abgeschlossen';

const FILTER: { key: Filter; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'aktiv', label: 'Laufend / pausiert' },
  { key: 'video', label: 'Mit Video' },
  { key: 'text', label: 'Nur Text' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
];

const SPALTEN: { key: Spalte; label: string; zahl: boolean; nurVideo?: boolean }[] = [
  { key: 'name', label: 'Kampagne', zahl: false },
  { key: 'status', label: 'Status', zahl: false },
  { key: 'erstellt', label: 'Angelegt', zahl: true },
  { key: 'leads', label: 'Leads', zahl: true },
  { key: 'gerendert', label: 'Gerendert', zahl: true, nurVideo: true },
  { key: 'gesendet', label: 'Gesendet', zahl: true },
  { key: 'antworten', label: 'Antworten', zahl: true },
  { key: 'antwortRate', label: 'Antwortrate', zahl: true },
  { key: 'seitenaufrufe', label: 'Seitenaufrufe', zahl: true, nurVideo: true },
  { key: 'videostarts', label: 'Videostarts', zahl: true, nurVideo: true },
  { key: 'sehdauer', label: 'Ø Sehdauer', zahl: true, nurVideo: true },
  { key: 'terminKlicks', label: 'Termin-Klicks', zahl: true, nurVideo: true },
  { key: 'abmeldungen', label: 'Abmeldungen', zahl: true },
];

const datum = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short' });

/** Kampagnenübersicht: durchsuchbar, filterbar, nach jeder Spalte sortierbar. */
export function KampagnenTabelle({ kampagnen }: { kampagnen: KampagnenZeile[] }) {
  const [suche, setSuche] = useState('');
  const [filter, setFilter] = useState<Filter>('alle');

  const gefiltert = kampagnen.filter((k) => {
    if (!passt(suche, k.name)) return false;
    if (filter === 'aktiv') return k.status === 'versendet_laufend' || k.status === 'pausiert' || k.status === 'rendert';
    if (filter === 'video') return k.mitVideo;
    if (filter === 'text') return !k.mitVideo;
    if (filter === 'abgeschlossen') return k.status === 'abgeschlossen';
    return true;
  });
  // Video-Kennzahlen von Text-Kampagnen zählen beim Sortieren als leer
  const { sortiert, key, asc, sortieren } = useSortierung<KampagnenZeile, Spalte>(
    gefiltert,
    (k, s) => (SPALTEN.find((x) => x.key === s)?.nurVideo && !k.mitVideo ? null : k[s]),
    { key: 'erstellt', asc: false },
  );

  const videoWert = (k: KampagnenZeile, v: string | number) => (k.mitVideo ? v : '–');

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Suche wert={suche} onChange={setSuche} platzhalter="Kampagne suchen" />
        <FilterChips optionen={FILTER} aktiv={filter} onChange={setFilter} />
        <span className="text-xs text-slate-500">
          {sortiert.length} von {kampagnen.length} Kampagnen
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {SPALTEN.map((s) => (
                <SortKopf key={s.key} label={s.label} rechts={s.zahl && s.key !== 'erstellt'} aktiv={key === s.key} asc={asc} onClick={() => sortieren(s.key, !s.zahl)} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortiert.map((k) => (
              <tr key={k.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/kampagnen/${k.id}`} className="font-medium text-indigo-600 hover:underline">
                    {k.name}
                  </Link>
                  {!k.mitVideo && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Nur Text</span>}
                </td>
                <td className="px-3 py-2">
                  <Badge status={k.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{datum.format(k.erstellt)}</td>
                <td className="px-3 py-2 text-right">{k.leads}</td>
                <td className="px-3 py-2 text-right">{videoWert(k, k.gerendert)}</td>
                <td className="px-3 py-2 text-right">{k.gesendet}</td>
                <td className="px-3 py-2 text-right">{k.antworten}</td>
                <td className="px-3 py-2 text-right">{k.antwortRate != null ? `${(k.antwortRate * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : '–'}</td>
                <td className="px-3 py-2 text-right">{videoWert(k, k.seitenaufrufe)}</td>
                <td className="px-3 py-2 text-right">{videoWert(k, k.videostarts)}</td>
                <td className="px-3 py-2 text-right">{videoWert(k, k.sehdauer != null ? `${k.sehdauer} %` : '–')}</td>
                <td className="px-3 py-2 text-right">{videoWert(k, k.terminKlicks)}</td>
                <td className="px-3 py-2 text-right">{k.abmeldungen}</td>
              </tr>
            ))}
            {sortiert.length === 0 && (
              <tr>
                <td colSpan={SPALTEN.length} className="px-3 py-6 text-center text-slate-500">
                  Keine Kampagne für diese Suche bzw. diesen Filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
