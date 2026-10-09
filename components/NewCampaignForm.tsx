'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewCampaignForm({ defaultCtaUrl }: { defaultCtaUrl: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ctaUrl, setCtaUrl] = useState(defaultCtaUrl);
  const [mitVideo, setMitVideo] = useState(true);
  const [fehler, setFehler] = useState('');
  const [laedt, setLaedt] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setLaedt(true);
    setFehler('');
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ctaUrl, mitVideo }),
    });
    if (res.ok) {
      const k = await res.json();
      router.push(`/kampagnen/${k.id}/import`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setFehler(data.error ?? 'Kampagne konnte nicht angelegt werden');
    setLaedt(false);
  }

  const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
  return (
    <form onSubmit={absenden} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <label className="block text-sm font-medium text-slate-700">
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} className={feld} placeholder="z. B. Einkaufsleiter Bau Q4" />
      </label>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Art der Kampagne</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {[
            { wert: true, titel: 'Mit Video', text: 'Für jeden Lead wird ein persönliches Video gerendert und in der Mail verlinkt.' },
            { wert: false, titel: 'Nur Text', text: 'Klassische Text-Mails ohne Video – sofort nach dem Import versandbereit.' },
          ].map((o) => (
            <label
              key={o.titel}
              className={`cursor-pointer rounded-md border p-3 text-sm ${mitVideo === o.wert ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
            >
              <input type="radio" name="art" className="sr-only" checked={mitVideo === o.wert} onChange={() => setMitVideo(o.wert)} />
              <span className="block font-medium text-slate-800">{o.titel}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{o.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm font-medium text-slate-700">
        Termin-Link
        <input required type="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className={feld} />
      </label>
      <p className="text-xs text-slate-500">Der E-Mail-Flow (Erstmail + Follow-ups) wird mit einem Standardtext angelegt und kann danach angepasst werden.</p>
      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      <button type="submit" disabled={laedt} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {laedt ? 'Anlegen …' : 'Kampagne anlegen'}
      </button>
    </form>
  );
}
