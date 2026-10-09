'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LEAD_STATUS, LEAD_STATUS_INFO } from '@/lib/lead-status';

/** Dropdown zum Ändern des Lead-Status (speichert sofort per PATCH). */
export function LeadStatusSelect({ leadId, status }: { leadId: number; status: string }) {
  const router = useRouter();
  const [wert, setWert] = useState(status);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function aendern(neu: string) {
    const alt = wert;
    setWert(neu);
    setBusy(true);
    setFehler(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadStatus: neu }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Fehler ${res.status}`);
      router.refresh();
    } catch (e) {
      setWert(alt);
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <select
        value={wert}
        disabled={busy}
        onChange={(e) => aendern(e.target.value)}
        aria-label="Lead-Status"
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 disabled:opacity-60"
      >
        {LEAD_STATUS.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_INFO[s].label}
          </option>
        ))}
      </select>
      {fehler && <span className="mt-1 text-xs text-red-700">{fehler}</span>}
    </span>
  );
}

/** Button „als gelesen/ungelesen markieren“ für eine Antwort */
export function GelesenButton({ leadId, gelesen }: { leadId: number; gelesen: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function umschalten() {
    setBusy(true);
    try {
      await fetch(`/api/leads/${leadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ antwortGelesen: !gelesen }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={umschalten} disabled={busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      {gelesen ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
    </button>
  );
}
