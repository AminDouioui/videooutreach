'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Firma = { id: number; name: string; rechtsform: string | null; strasse: string | null; plz: string | null; ort: string | null; domain: string | null; registerKey: string | null; quellen: string[] };
export type PruefFall = { id: number; score: number; details: Record<string, number | null>; neu: Firma; kandidat: Firma };

const DETAIL: Record<string, string> = { name: 'Name', strasse: 'Straße', plz: 'PLZ', ort: 'Ort', domain: 'Domain', register: 'Register' };

function FirmaKarte({ titel, f }: { titel: string; f: Firma }) {
  return (
    <div className="min-w-0 flex-1 rounded-md border border-slate-200 p-3 text-sm">
      <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">{titel}</div>
      <div className="font-medium">{[f.name, f.rechtsform].filter(Boolean).join(' ')}</div>
      <div className="text-slate-600">{f.strasse}</div>
      <div className="text-slate-600">{[f.plz, f.ort].filter(Boolean).join(' ')}</div>
      {f.domain && <div className="text-slate-600">{f.domain}</div>}
      {f.registerKey && <div className="text-xs text-slate-500">Register: {f.registerKey.replace(/\|/g, ' ')}</div>}
      <div className="mt-1 text-xs text-slate-500">Quellen: {f.quellen.join(', ') || '–'}</div>
    </div>
  );
}

/** Unsichere Treffer der Entity Resolution: dieselbe Firma oder zwei verschiedene? */
export function LeadgenPruefung({ faelle }: { faelle: PruefFall[] }) {
  const router = useRouter();
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  async function entscheiden(id: number, aktion: 'zusammenfuehren' | 'trennen') {
    setBusy(id);
    setFehler('');
    try {
      const res = await fetch('/api/leadgen/pruefung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, aktion }) });
      if (!res.ok) setFehler((await res.json().catch(() => ({}))).error ?? 'Entscheidung fehlgeschlagen');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (faelle.length === 0) return <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Keine offenen Prüffälle.</p>;
  return (
    <div className="space-y-4">
      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      {faelle.map((f) => (
        <section key={f.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Übereinstimmung {Math.round(f.score * 100)} %</span>
            <span className="text-xs text-slate-500">{Object.entries(f.details).filter(([, v]) => v !== null).map(([k, v]) => `${DETAIL[k] ?? k} ${Math.round((v as number) * 100)} %`).join(' · ')}</span>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <FirmaKarte titel="Neu" f={f.neu} />
            <FirmaKarte titel="Bestehende Firma" f={f.kandidat} />
          </div>
          <div className="mt-3 flex gap-2">
            <button disabled={busy === f.id} onClick={() => entscheiden(f.id, 'zusammenfuehren')} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              Dieselbe Firma (zusammenführen)
            </button>
            <button disabled={busy === f.id} onClick={() => entscheiden(f.id, 'trennen')} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
              Verschiedene Firmen
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
