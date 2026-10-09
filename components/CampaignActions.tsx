'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const sekundaer = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

/** Aktionsleiste der Kampagne: Import, Rendern (nur Video-Kampagnen), E-Mail-Flow, Einstellungen, Löschen. */
export function CampaignActions({ campaignId, campaignName, leadCount, mitVideo }: { campaignId: number; campaignName: string; leadCount: number; mitVideo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'all' | 'failed' | 'loeschen' | null>(null);
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

  async function loeschen() {
    const text =
      `Kampagne „${campaignName}“ endgültig löschen?\n\n` +
      `Gelöscht werden ${leadCount} Lead(s), alle Tracking-Daten, der E-Mail-Flow` +
      (mitVideo ? ' und alle gerenderten Videos' : '') +
      `.\nBereits gesendete Mails bleiben in Gmail. Das lässt sich nicht rückgängig machen.`;
    if (!confirm(text)) return;
    setBusy('loeschen');
    setMeldung(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Löschen fehlgeschlagen');
      router.push('/');
      router.refresh();
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Fehler');
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/kampagnen/${campaignId}/import`} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
        Leads importieren
      </Link>
      {mitVideo && leadCount > 0 && (
        <button onClick={() => rendern('all')} disabled={busy !== null} className={sekundaer}>
          {busy === 'all' ? 'Wird eingereiht …' : 'Alle rendern'}
        </button>
      )}
      {mitVideo && (
        <button onClick={() => rendern('failed')} disabled={busy !== null} className={sekundaer}>
          {busy === 'failed' ? 'Wird eingereiht …' : 'Fehlgeschlagene erneut rendern'}
        </button>
      )}
      <Link href={`/kampagnen/${campaignId}/analyse`} className={sekundaer}>
        Analyse
      </Link>
      <Link href={`/kampagnen/${campaignId}/vorlage`} className={sekundaer}>
        E-Mail-Flow
      </Link>
      <Link href={`/kampagnen/${campaignId}/einstellungen`} className={sekundaer}>
        Einstellungen
      </Link>
      <button
        onClick={loeschen}
        disabled={busy !== null}
        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {busy === 'loeschen' ? 'Wird gelöscht …' : 'Löschen'}
      </button>
      {meldung && <span className="text-sm text-slate-500">{meldung}</span>}
    </div>
  );
}
