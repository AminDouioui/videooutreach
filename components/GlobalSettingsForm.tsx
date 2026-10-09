'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Werte = {
  senderName: string;
  signature: string;
  globalDailyLimit: number;
  rampeAktiv: boolean;
  rampeStart: number;
  rampeSchritt: number;
  rampeBeginn: string;
  impressumUrl: string;
  datenschutzUrl: string;
};

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

export function GlobalSettingsForm({ initial, heuteErlaubt }: { initial: Werte; heuteErlaubt: number }) {
  const router = useRouter();
  const [w, setW] = useState<Werte>(initial);
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  const set = <K extends keyof Werte>(k: K, v: Werte[K]) => setW((x) => ({ ...x, [k]: v }));

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...w, globalDailyLimit: Number(w.globalDailyLimit), rampeStart: Number(w.rampeStart), rampeSchritt: Number(w.rampeSchritt) }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus({ text: 'Gespeichert', fehler: false });
      router.refresh();
    } else setStatus({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  return (
    <form onSubmit={speichern} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold">Absender &amp; Versand</h2>
      <label className="block text-sm font-medium text-slate-700">
        Absendername
        <input value={w.senderName} onChange={(e) => set('senderName', e.target.value)} className={feld} placeholder="z. B. Amin Douioui" />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Signatur
        <textarea value={w.signature} onChange={(e) => set('signature', e.target.value)} rows={6} className={`${feld} font-mono`} placeholder={'Amin Douioui\nProzessia GmbH\nTelefon …\nImpressum: https://…'} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Zeilenumbrüche bleiben erhalten. Hier gehören die Impressumsangaben hin.</span>
      </label>
      <label className="block text-sm font-medium text-slate-700 sm:max-w-xs">
        Globales Tageslimit (alle Kampagnen)
        <input required type="number" min={1} max={2000} value={w.globalDailyLimit} onChange={(e) => set('globalDailyLimit', Number(e.target.value))} className={feld} />
      </label>
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Aufwärmrampe</legend>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={w.rampeAktiv} onChange={(e) => set('rampeAktiv', e.target.checked)} />
          <span>
            Tageslimit langsam steigern
            <span className="block text-xs text-slate-500">
              Startet mit dem Startwert und steigt täglich um den Schritt, höchstens bis zum globalen Tageslimit. Gut für neue Absenderadressen.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium text-slate-700">
            Startwert (Mails am 1. Tag)
            <input type="number" min={1} max={2000} value={w.rampeStart} onChange={(e) => set('rampeStart', Number(e.target.value))} className={feld} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Steigerung pro Tag
            <input type="number" min={0} max={500} value={w.rampeSchritt} onChange={(e) => set('rampeSchritt', Number(e.target.value))} className={feld} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Beginn (optional)
            <input type="date" value={w.rampeBeginn} onChange={(e) => set('rampeBeginn', e.target.value)} className={feld} />
          </label>
        </div>
        <p className="text-xs text-slate-500">Ohne Beginn zählt der Tag der ersten gesendeten Mail (noch keine: heute). Zum Übernehmen der Änderungen speichern.</p>
        <p className="text-sm font-medium text-slate-800">Heute erlaubt: {heuteErlaubt} {heuteErlaubt === 1 ? 'Mail' : 'Mails'}</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Impressum-URL
          <input type="url" value={w.impressumUrl} onChange={(e) => set('impressumUrl', e.target.value)} className={feld} placeholder="https://…" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Datenschutz-URL
          <input type="url" value={w.datenschutzUrl} onChange={(e) => set('datenschutzUrl', e.target.value)} className={feld} placeholder="https://…" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Speichern
        </button>
        {status && <span className={`text-sm ${status.fehler ? 'text-red-600' : 'text-green-700'}`}>{status.text}</span>}
      </div>
    </form>
  );
}
