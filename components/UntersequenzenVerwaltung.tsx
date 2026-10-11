'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LEAD_STATUS, LEAD_STATUS_INFO } from '@/lib/lead-status';
import type { RegelAnsicht } from '@/lib/untersequenzen-db';

const feld = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
// „Offen“ ist der Ausgangszustand und löst nie etwas aus
const AUSLOESER = LEAD_STATUS.filter((s) => s !== 'offen');

/** Regeln „Wenn Lead-Status = X → in Kampagne Y übernehmen“ einer Kampagne anlegen, (de)aktivieren, löschen. */
export function UntersequenzenVerwaltung({ campaignId, regeln, ziele }: { campaignId: number; regeln: RegelAnsicht[]; ziele: { id: number; name: string }[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(AUSLOESER[0]);
  const [ziel, setZiel] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);

  async function aufruf(url: string, init: RequestInit, erfolg: string) {
    setBusy(true);
    setMeldung(null);
    try {
      const res = await fetch(url, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Fehler ${res.status}`);
      setMeldung({ text: erfolg, fehler: false });
      router.refresh();
    } catch (e) {
      setMeldung({ text: e instanceof Error ? e.message : 'Aktion fehlgeschlagen', fehler: true });
    } finally {
      setBusy(false);
    }
  }

  const json = { 'Content-Type': 'application/json' };
  const basis = `/api/campaigns/${campaignId}/untersequenzen`;

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5" aria-label="Untersequenzen">
      <h2 className="text-base font-semibold">Untersequenzen</h2>
      <p className="mt-1 text-sm text-slate-500">
        Wird ein Lead dieser Kampagne auf einen Status gesetzt (manuell, in der Pipeline oder per KI), wird er als Kopie in die Ziel-Kampagne übernommen und dort startet sein Flow neu. Nicht übernommen werden abgemeldete oder gesperrte Adressen, Leads, die dort schon
        vorkommen, und die eigene Kampagne. Die Ziel-Kampagne muss nicht laufen.
      </p>
      {regeln.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Noch keine Regeln.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
          {regeln.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm ${r.aktiv ? '' : 'text-slate-400'}`}>
              <span className="min-w-0 flex-1 break-words">
                Wenn Status <strong>{LEAD_STATUS_INFO[r.ausloeserStatus].label}</strong> → in <strong>{r.zielName}</strong> übernehmen
                {!r.aktiv && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">inaktiv</span>}
              </span>
              <button
                disabled={busy}
                onClick={() => aufruf(`${basis}/${r.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ aktiv: !r.aktiv }) }, r.aktiv ? 'Regel deaktiviert.' : 'Regel aktiviert.')}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {r.aktiv ? 'Deaktivieren' : 'Aktivieren'}
              </button>
              <button
                disabled={busy}
                onClick={() => window.confirm('Regel löschen? Bereits übernommene Leads bleiben bestehen.') && aufruf(`${basis}/${r.id}`, { method: 'DELETE' }, 'Regel gelöscht.')}
                className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Löschen
              </button>
            </li>
          ))}
        </ul>
      )}
      {ziele.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Es gibt keine andere Kampagne als Ziel. Lege zuerst eine zweite Kampagne an.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            Wenn Lead-Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`mt-1 block ${feld}`}>
              {AUSLOESER.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_INFO[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-sm text-slate-700">
            in Kampagne übernehmen
            <select value={ziel} onChange={(e) => setZiel(e.target.value)} className={`mt-1 block max-w-full ${feld}`}>
              <option value="">Ziel-Kampagne wählen …</option>
              {ziele.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !ziel}
            onClick={() => aufruf(basis, { method: 'POST', headers: json, body: JSON.stringify({ ausloeserStatus: status, zielCampaignId: Number(ziel) }) }, 'Regel angelegt.')}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Regel anlegen
          </button>
        </div>
      )}
      {meldung && <p className={`mt-2 text-sm ${meldung.fehler ? 'text-red-700' : 'text-green-700'}`}>{meldung.text}</p>}
    </section>
  );
}
