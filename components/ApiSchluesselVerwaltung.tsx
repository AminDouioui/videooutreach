'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from './CopyButton';

type Schluessel = { id: number; name: string; praefix: string; rechte: 'lesen' | 'schreiben'; letzteNutzungAt: string | null; createdAt: string; widerrufenAt: string | null };

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });

export function ApiSchluesselVerwaltung({ schluessel }: { schluessel: Schluessel[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [rechte, setRechte] = useState<'lesen' | 'schreiben'>('lesen');
  const [fehler, setFehler] = useState('');
  const [neu, setNeu] = useState<string | null>(null);

  async function anlegen(e: React.FormEvent) {
    e.preventDefault();
    setFehler('');
    const res = await fetch('/api/api-schluessel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, rechte }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setFehler(data.error ?? 'Anlegen fehlgeschlagen');
    setName('');
    setNeu(data.schluessel);
    router.refresh();
  }

  async function widerrufen(k: Schluessel) {
    if (!confirm(`API-Schlüssel „${k.name}“ (${k.praefix}…) widerrufen? Anwendungen mit diesem Schlüssel verlieren sofort den Zugriff.`)) return;
    const res = await fetch(`/api/api-schluessel/${k.id}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
    else setFehler((await res.json().catch(() => ({}))).error ?? 'Widerrufen fehlgeschlagen');
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-base font-semibold">API-Schlüssel</h2>
      <p className="mb-3 text-xs text-slate-500">
        Für die REST-API unter <code>/api/v1</code>. Gespeichert wird nur ein Hash; der Schlüssel wird einmalig bei der Erstellung angezeigt. „Lesen“ erlaubt nur GET, „Schreiben“ zusätzlich Leads anlegen und ändern.
      </p>

      <form onSubmit={anlegen} className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-48 text-sm font-medium text-slate-700">
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="z. B. CRM-Anbindung" className={feld} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Rechte
          <select value={rechte} onChange={(e) => setRechte(e.target.value as 'lesen' | 'schreiben')} className={feld}>
            <option value="lesen">Lesen</option>
            <option value="schreiben">Schreiben</option>
          </select>
        </label>
        <button type="submit" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Schlüssel erstellen</button>
      </form>
      {fehler && <p className="mb-2 text-sm text-red-600">{fehler}</p>}

      {neu && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Neuer API-Schlüssel – jetzt kopieren, er wird nicht wieder angezeigt:</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{neu}</code>
            <CopyButton text={neu} />
            <button onClick={() => setNeu(null)} className="text-xs text-slate-600 hover:underline">Ausblenden</button>
          </div>
        </div>
      )}

      {schluessel.length === 0 ? (
        <p className="text-sm text-slate-500">Noch keine API-Schlüssel.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Name</th>
                <th className="py-1 pr-3 font-medium">Präfix</th>
                <th className="py-1 pr-3 font-medium">Rechte</th>
                <th className="py-1 pr-3 font-medium">Letzte Nutzung</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schluessel.map((k) => (
                <tr key={k.id} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-3 break-words">{k.name}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{k.praefix}…</td>
                  <td className="py-1.5 pr-3">{k.rechte === 'schreiben' ? 'Schreiben' : 'Lesen'}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{k.widerrufenAt ? <span className="text-red-600">widerrufen {zeit.format(new Date(k.widerrufenAt))}</span> : k.letzteNutzungAt ? zeit.format(new Date(k.letzteNutzungAt)) : 'noch nie'}</td>
                  <td className="py-1.5 text-right">{!k.widerrufenAt && <button onClick={() => widerrufen(k)} className="text-xs font-medium text-red-600 hover:underline">Widerrufen</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
