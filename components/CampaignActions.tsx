'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const sekundaer = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const gesperrt = 'cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-400';

/** Aktionsleiste der Kampagne. Platzhalter-Buttons werden in späteren Phasen aktiviert. */
export function CampaignActions({ campaignId, leadCount }: { campaignId: number; leadCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'all' | 'failed' | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  async function rendern(mode: 'all' | 'failed') {
    setBusy(mode);
    setMeldung(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json().catch(() => ({}))) as { queued?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Anfrage fehlgeschlagen');
      setMeldung(data.queued ? `${data.queued} Video(s) eingereiht.` : 'Nichts zu rendern.');
      router.refresh();
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(null);
    }
  }

  const platzhalter = (label: string) => (
    <button key={label} disabled title="Folgt in einer späteren Phase" className={gesperrt}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/kampagnen/${campaignId}/import`} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
        Leads importieren
      </Link>
      {leadCount > 0 && (
        <button onClick={() => rendern('all')} disabled={busy !== null} className={sekundaer}>
          {busy === 'all' ? 'Wird eingereiht …' : 'Alle rendern'}
        </button>
      )}
      <button onClick={() => rendern('failed')} disabled={busy !== null} className={sekundaer}>
        {busy === 'failed' ? 'Wird eingereiht …' : 'Fehlgeschlagene erneut rendern'}
      </button>
      {platzhalter('Versand starten')}
      {platzhalter('Vorlage bearbeiten')}
      {platzhalter('CSV-Export')}
      <Link href="/" className={sekundaer}>
        Zur Übersicht
      </Link>
      {meldung && <span className="text-sm text-slate-500">{meldung}</span>}
    </div>
  );
}
