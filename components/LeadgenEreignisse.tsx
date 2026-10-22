'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type Ereignis = {
  id: number;
  typ: string;
  text: string;
  status: string;
  erkanntAm: number;
  companyId: number | null;
  firma: string;
  daten: { neu?: Array<{ name: string; rolle: string }>; alt?: Array<{ name: string; rolle: string }>; datum?: string | null };
};

const datum = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short' });

/** Outreach-Trigger aus dem Handelsregister: neuer Geschäftsführer, Wechsel oder Neueintragung. */
export function LeadgenEreignisse({ ereignisse }: { ereignisse: Ereignis[] }) {
  const router = useRouter();
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  async function aktion(id: number, a: 'gesehen' | 'anreichern') {
    setBusy(id);
    setFehler('');
    try {
      const res = await fetch('/api/leadgen/ereignisse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, aktion: a }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; runId?: number };
      if (!res.ok) setFehler(data.error ?? 'Aktion fehlgeschlagen');
      else if (a === 'anreichern' && data.runId) router.push(`/leads-generieren/${data.runId}`);
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (ereignisse.length === 0) return null;
  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-5" data-testid="leadgen-ereignisse">
      <h2 className="mb-1 text-base font-semibold">Register-Ereignisse als Anlass für Outreach</h2>
      <p className="mb-3 text-xs text-slate-600">Ein neuer Geschäftsführer oder eine Neueintragung ist ein guter Zeitpunkt, den Kontakt neu zu suchen und anzuschreiben.</p>
      {fehler && <p className="mb-2 text-sm text-red-600">{fehler}</p>}
      <ul className="divide-y divide-indigo-100 rounded-md bg-white text-sm">
        {ereignisse.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="font-medium">{e.firma}</span>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">{e.text}</span>
            <span className="text-xs text-slate-600">
              {e.daten.neu?.length ? `neu: ${e.daten.neu.map((p) => `${p.name} (${p.rolle})`).join(', ')}` : ''}
              {e.daten.alt?.length ? ` ausgeschieden: ${e.daten.alt.map((p) => p.name).join(', ')}` : ''}
            </span>
            <span className="text-xs text-slate-400">{e.daten.datum ? datum.format(new Date(e.daten.datum)) : datum.format(e.erkanntAm)}</span>
            <span className="ml-auto flex gap-2">
              <button disabled={busy === e.id} onClick={() => aktion(e.id, 'anreichern')} className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                Kontakt neu suchen
              </button>
              <button disabled={busy === e.id} onClick={() => aktion(e.id, 'gesehen')} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                Ausblenden
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        Die Ereignisse stammen aus Registerdaten-Importen und Bekanntmachungen.
      </p>
    </section>
  );
}
