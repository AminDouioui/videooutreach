'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Status = {
  id: number;
  status: string;
  firmen: number;
  stufen: Array<{ stufe: string; label: string; ebene: string; offen: number; laeuft: number; fertig: number; fehler: number }>;
  fehlerhafteJobs: Array<{ id: number; stufe: string; firma: string | null; versuche: number; fehler: string | null }>;
  kostenMilliCent: number;
  kosten: Array<{ anbieter: string; art: string; einheiten: number; kostenMilliCent: number }>;
};

const STATUS_LABEL: Record<string, string> = { laeuft: 'Läuft', fertig: 'Fertig', fehler: 'Fehlgeschlagen', abgebrochen: 'Abgebrochen' };

const euro = (milliCent: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(milliCent / 100_000);

/** Fortschritt je Stufe mit Zählern, fehlgeschlagenen Jobs (mit „Erneut versuchen“) und den Kosten des Laufs; pollt, solange der Lauf läuft. */
export function LeadgenFortschritt({ initial, onAktualisiert }: { initial: Status; onAktualisiert?: (s: Status) => void }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const vorher = useRef(initial.status);
  const [meldung, setMeldung] = useState('');

  const lade = useCallback(async () => {
    try {
      const res = await fetch(`/api/leadgen/runs/${initial.id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const neu = (await res.json()) as Status;
      setS(neu);
      onAktualisiert?.(neu);
      if (vorher.current === 'laeuft' && neu.status !== 'laeuft') router.refresh();
      vorher.current = neu.status;
    } catch {
      // Netzwerkfehler: beim nächsten Takt erneut
    }
  }, [initial.id, onAktualisiert, router]);

  useEffect(() => {
    if (s.status !== 'laeuft') return;
    const t = setInterval(lade, 3000);
    return () => clearInterval(t);
  }, [s.status, lade]);

  async function erneut(jobId: number) {
    setMeldung('');
    const res = await fetch(`/api/leadgen/jobs/${jobId}/erneut`, { method: 'POST' });
    if (!res.ok) setMeldung((await res.json().catch(() => ({}))).error ?? 'Wiederholen fehlgeschlagen');
    await lade();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" data-testid="leadgen-fortschritt">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Fortschritt</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.status === 'laeuft' ? 'bg-indigo-100 text-indigo-800' : s.status === 'fertig' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
        <span className="text-sm text-slate-500">{s.firmen} Firmen im Lauf</span>
        <span className="ml-auto text-sm text-slate-500" title={s.kosten.map((k) => `${k.anbieter} ${k.art}: ${euro(k.kostenMilliCent)} (${k.einheiten})`).join('\n') || 'Noch keine Kosten'}>
          Kosten: {euro(s.kostenMilliCent)}
        </span>
      </div>
      <ol className="space-y-2">
        {s.stufen.map((st) => {
          const gesamt = st.offen + st.laeuft + st.fertig + st.fehler;
          if (gesamt === 0) return null;
          const prozent = Math.round((st.fertig / gesamt) * 100);
          return (
            <li key={st.stufe} className="text-sm">
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">{st.label}</span>
                <span className="text-xs text-slate-500">
                  {st.fertig} / {gesamt} fertig{st.laeuft > 0 ? `, ${st.laeuft} läuft` : ''}
                  {st.offen > 0 ? `, ${st.offen} wartet` : ''}
                  {st.fehler > 0 ? `, ${st.fehler} Fehler` : ''}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuenow={prozent} aria-valuemin={0} aria-valuemax={100} aria-label={st.label}>
                <div className={`h-full ${st.fehler > 0 ? 'bg-amber-500' : 'bg-indigo-600'}`} style={{ width: `${prozent}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
      {s.fehlerhafteJobs.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold text-red-700">Fehlgeschlagene Jobs ({s.fehlerhafteJobs.length})</h3>
          <ul className="divide-y divide-slate-100 rounded-md border border-red-100 text-sm">
            {s.fehlerhafteJobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium">{j.firma ?? 'Gesamter Lauf'}</span>
                <span className="text-xs text-slate-500">
                  Stufe {j.stufe}, {j.versuche} Versuche
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-red-700" title={j.fehler ?? ''}>
                  {j.fehler}
                </span>
                <button onClick={() => erneut(j.id)} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">
                  Erneut versuchen
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {meldung && <p className="mt-2 text-sm text-red-600">{meldung}</p>}
    </section>
  );
}
