'use client';

import { useState } from 'react';

/** Brave-Search-Schlüssel (verschlüsselt gespeichert) und Extraktionsmodell; nur für Admins sichtbar. */
export function LeadgenEinstellungen({ braveGesetzt, modell }: { braveGesetzt: boolean; modell: string }) {
  const [key, setKey] = useState('');
  const [m, setM] = useState(modell);
  const [gesetzt, setGesetzt] = useState(braveGesetzt);
  const [meldung, setMeldung] = useState('');

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setMeldung('');
    const res = await fetch('/api/leadgen/einstellungen', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(key ? { braveSchluessel: key } : {}), extraktionModell: m }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; braveGesetzt?: boolean };
    if (!res.ok) setMeldung(data.error ?? 'Speichern fehlgeschlagen');
    else {
      setKey('');
      setGesetzt(!!data.braveGesetzt);
      setMeldung('Gespeichert.');
    }
  }

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-medium text-slate-700">Einstellungen der Lead-Generierung</summary>
      <form onSubmit={speichern} className="mt-3 flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-slate-600">Brave-Search-Schlüssel {gesetzt ? '(gesetzt)' : '(fehlt)'}</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={gesetzt ? 'unverändert lassen' : 'Schlüssel eingeben'} className="w-72 rounded-md border border-slate-300 px-3 py-1.5" />
        </label>
        <label>
          <span className="mb-1 block text-slate-600">Modell der Extraktion</span>
          <input value={m} onChange={(e) => setM(e.target.value)} className="w-56 rounded-md border border-slate-300 px-3 py-1.5" />
        </label>
        <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
          Speichern
        </button>
        {meldung && <span className="text-slate-600">{meldung}</span>}
      </form>
      <p className="mt-2 text-xs text-slate-500">Der OpenAI-Schlüssel steht unter Einstellungen → KI, der SMTP-Prüfdienst (REACHER_URL) in der .env.</p>
    </details>
  );
}
