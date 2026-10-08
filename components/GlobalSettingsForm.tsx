'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Werte = { senderName: string; signature: string; globalDailyLimit: number; impressumUrl: string; datenschutzUrl: string };

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

export function GlobalSettingsForm({ initial }: { initial: Werte }) {
  const router = useRouter();
  const [w, setW] = useState<Werte>(initial);
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  const set = <K extends keyof Werte>(k: K, v: Werte[K]) => setW((x) => ({ ...x, [k]: v }));

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...w, globalDailyLimit: Number(w.globalDailyLimit) }) });
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
