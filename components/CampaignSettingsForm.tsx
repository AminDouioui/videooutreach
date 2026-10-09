'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ALLE_WOCHENTAGE, WOCHENTAG_KURZ } from '@/lib/time';

type Werte = {
  name: string;
  ctaUrl: string;
  dailySendLimit: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  sendDays: number[];
  startDatum: string;
  maxNeueLeadsProTag: number | null;
  trackingPixel: boolean;
  stoppBeiFirmenAntwort: boolean;
};

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

export function CampaignSettingsForm({ campaignId, initial }: { campaignId: number; initial: Werte }) {
  const router = useRouter();
  const [w, setW] = useState<Werte>(initial);
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  const set = <K extends keyof Werte>(k: K, v: Werte[K]) => setW((x) => ({ ...x, [k]: v }));

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch(`/api/campaigns/${campaignId}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...w, dailySendLimit: Number(w.dailySendLimit), startDatum: w.startDatum || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus({ text: 'Gespeichert', fehler: false });
      router.refresh();
    } else setStatus({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  return (
    <form onSubmit={speichern} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <label className="block text-sm font-medium text-slate-700">
        Name
        <input required value={w.name} onChange={(e) => set('name', e.target.value)} className={feld} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Termin-Link
        <input required type="url" value={w.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} className={feld} />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          Tageslimit (Kampagne)
          <input required type="number" min={1} max={500} value={w.dailySendLimit} onChange={(e) => set('dailySendLimit', Number(e.target.value))} className={feld} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Versandfenster ab
          <input required type="time" value={w.sendWindowStart} onChange={(e) => set('sendWindowStart', e.target.value)} className={feld} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Versandfenster bis
          <input required type="time" value={w.sendWindowEnd} onChange={(e) => set('sendWindowEnd', e.target.value)} className={feld} />
        </label>
      </div>
      <p className="-mt-2 text-xs text-slate-500">Zeiten in Europe/Berlin. Zusätzlich gilt das globale Tageslimit aus den Einstellungen.</p>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Versandtage</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {ALLE_WOCHENTAGE.map((tag) => (
            <label key={tag} className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={w.sendDays.includes(tag)}
                onChange={(e) => set('sendDays', e.target.checked ? [...w.sendDays, tag].sort() : w.sendDays.filter((t) => t !== tag))}
              />
              {WOCHENTAG_KURZ[tag - 1]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Startdatum (optional)
          <input type="date" value={w.startDatum} onChange={(e) => set('startDatum', e.target.value)} className={feld} />
          <span className="mt-1 block text-xs font-normal text-slate-500">Vorher wird nicht gesendet. Leer = sofort nach dem Start.</span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Neue Leads pro Tag (optional)
          <input
            type="number"
            min={1}
            max={500}
            value={w.maxNeueLeadsProTag ?? ''}
            onChange={(e) => set('maxNeueLeadsProTag', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="unbegrenzt"
            className={feld}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">Begrenzt nur Erstmails. Fällige Follow-ups haben Vorrang und zählen nicht mit; für sie gilt das Tageslimit.</span>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={w.trackingPixel} onChange={(e) => set('trackingPixel', e.target.checked)} />
        <span>
          Öffnungs-Pixel einbinden
          <span className="block text-xs text-slate-500">Unzuverlässig (Mail-Programme laden Bilder oft nicht oder immer) und datenschutzrelevant. Standard: aus.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={w.stoppBeiFirmenAntwort} onChange={(e) => set('stoppBeiFirmenAntwort', e.target.checked)} />
        <span>
          Bei Antwort einer Firma alle Kontakte dieser Firma stoppen
          <span className="block text-xs text-slate-500">
            Antwortet ein Kontakt, bekommen die anderen Leads mit derselben E-Mail-Domain keine Follow-ups und keine Erstmail mehr. Private Mail-Anbieter (gmail.com, gmx.de, web.de …) sind ausgenommen.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Speichern
        </button>
        {status && <span className={`text-sm ${status.fehler ? 'text-red-600' : 'text-green-700'}`}>{status.text}</span>}
      </div>
    </form>
  );
}
