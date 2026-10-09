'use client';

import { useMemo, useState } from 'react';

// Gemeinsame Bausteine für sortier-, filter- und durchsuchbare Listen

type Wert = string | number | null | undefined;

/** Sortiert `eintraege` nach dem Wert der gewählten Spalte; Zahlen numerisch, Texte deutsch. Klick auf dieselbe Spalte dreht die Richtung. */
export function useSortierung<T, K extends string>(eintraege: T[], wert: (e: T, k: K) => Wert, start: { key: K; asc: boolean }) {
  const [key, setKey] = useState<K>(start.key);
  const [asc, setAsc] = useState(start.asc);
  const sortiert = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...eintraege].sort((a, b) => {
      const va = wert(a, key);
      const vb = wert(b, key);
      // Leere Werte immer ans Ende
      if (va == null || va === '') return vb == null || vb === '' ? 0 : 1;
      if (vb == null || vb === '') return -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de', { numeric: true });
      return c * dir;
    });
    // wert ist eine stabile Zugriffsfunktion des Aufrufers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eintraege, key, asc]);
  function sortieren(k: K, textSpalte = false) {
    if (k === key) setAsc(!asc);
    else {
      setKey(k);
      // Texte aufsteigend, Zahlen absteigend (größte zuerst)
      setAsc(textSpalte);
    }
  }
  return { sortiert, key, asc, sortieren };
}

/** Sortierbarer Spaltenkopf */
export function SortKopf({ label, aktiv, asc, onClick, rechts = false }: { label: string; aktiv: boolean; asc: boolean; onClick: () => void; rechts?: boolean }) {
  return (
    <th className={`px-3 py-2 ${rechts ? 'text-right' : ''}`} aria-sort={aktiv ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button onClick={onClick} className="inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wide hover:text-slate-900">
        {label}
        <span aria-hidden className="inline-block w-3">
          {aktiv ? (asc ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

/** Suchfeld */
export function Suche({ wert, onChange, platzhalter }: { wert: string; onChange: (v: string) => void; platzhalter: string }) {
  return (
    <input
      type="search"
      value={wert}
      onChange={(e) => onChange(e.target.value)}
      placeholder={platzhalter}
      className="w-64 max-w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
    />
  );
}

/** Filter-Chips (einer aktiv) */
export function FilterChips<K extends string>({ optionen, aktiv, onChange }: { optionen: { key: K; label: string; anzahl?: number }[]; aktiv: K; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {optionen.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${aktiv === o.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'}`}
        >
          {o.label}
          {o.anzahl !== undefined && <span className="ml-1 opacity-70">{o.anzahl}</span>}
        </button>
      ))}
    </div>
  );
}

/** Suchtext enthalten (case-insensitiv) in einem der Felder? */
export function passt(q: string, ...felder: (string | null | undefined)[]): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return felder.some((f) => (f ?? '').toLowerCase().includes(s));
}
