'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewCampaignForm({ defaultCtaUrl }: { defaultCtaUrl: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ctaUrl, setCtaUrl] = useState(defaultCtaUrl);
  const [fehler, setFehler] = useState('');
  const [laedt, setLaedt] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setLaedt(true);
    setFehler('');
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ctaUrl }),
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
      <label className="block text-sm font-medium text-slate-700">
        Termin-Link
        <input required type="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className={feld} />
      </label>
      <p className="text-xs text-slate-500">Mail-Vorlagen werden mit Standardtexten angelegt und können später angepasst werden.</p>
      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      <button type="submit" disabled={laedt} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {laedt ? 'Anlegen …' : 'Kampagne anlegen'}
      </button>
    </form>
  );
}
