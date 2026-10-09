'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Status = {
  total: number;
  wartet: number;
  rendert: number;
  fertig: number;
  fehler: number;
  angefordert: number;
  campaignStatus: string;
  renderFenster: string | null;
  renderFensterOffen: boolean;
};

/** Fortschrittsbalken „143 / 200 fertig“ mit Stoppen/Fortsetzen; pollt alle 3 s, solange Videos angefordert sind oder gerendert werden. */
export function RenderProgress({ campaignId, initial }: { campaignId: number; initial: Status }) {
  const router = useRouter();
  const [s, setS] = useState<Status>(initial);
  const vorher = useRef(initial);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => {
    setS(initial);
    vorher.current = initial;
  }, [initial]);

  const aktiv = s.angefordert > 0 || s.rendert > 0;

  const lade = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/status`, { cache: 'no-store' });
      if (!res.ok) return;
      const neu = (await res.json()) as Status;
      const warAktiv = vorher.current.angefordert > 0 || vorher.current.rendert > 0;
      const istAktiv = neu.angefordert > 0 || neu.rendert > 0;
      vorher.current = neu;
      setS(neu);
      // Fertig geworden oder gestoppt -> Tabelle serverseitig neu laden
      if (warAktiv && !istAktiv) router.refresh();
    } catch {
      // Netzwerkfehler: beim nächsten Takt erneut
    }
  }, [campaignId, router]);

  useEffect(() => {
    if (!aktiv) return;
    const t = setInterval(lade, 3000);
    return () => clearInterval(t);
  }, [aktiv, lade]);

  async function steuern(mode: 'stop' | 'all') {
    if (mode === 'stop' && !confirm('Rendern stoppen? Der laufende Job wird abgebrochen, die Warteschlange geleert. Fortsetzen ist jederzeit möglich.')) return;
    setBusy(true);
    setMeldung(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMeldung(data.error ?? 'Aktion fehlgeschlagen');
      }
      await lade();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (s.total === 0 || (!aktiv && s.fertig === 0 && s.fehler === 0)) return null;
  // Gestoppt (oder nie vollständig angefordert): offene Leads warten, nichts läuft
  const gestoppt = !aktiv && s.wartet > 0;
  const prozent = Math.round((s.fertig / s.total) * 100);
  return (
    <div className="mb-4 rounded-md border border-slate-200 bg-white p-3" aria-live="polite">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">
          {s.fertig} / {s.total} fertig
          {aktiv && <span className="ml-2 font-normal text-slate-500">· {s.rendert} in Arbeit, {s.angefordert - s.rendert} in der Warteschlange</span>}
        </span>
        <span className="flex items-center gap-3">
          {s.fehler > 0 && <span className="text-red-600">{s.fehler} fehlgeschlagen</span>}
          {aktiv && (
            <button onClick={() => steuern('stop')} disabled={busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {busy ? 'Wird gestoppt …' : 'Rendern stoppen'}
            </button>
          )}
          {gestoppt && (
            <button onClick={() => steuern('all')} disabled={busy} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {busy ? 'Wird eingereiht …' : `Rendern fortsetzen (${s.wartet} offen)`}
            </button>
          )}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-indigo-600 transition-all" style={{ width: `${prozent}%` }} />
      </div>
      {aktiv && s.renderFenster && !s.renderFensterOffen && (
        <p className="mt-1.5 text-xs text-slate-500">Gerendert wird nur zwischen {s.renderFenster.replace('-', ' und ')} Uhr – die Warteschlange läuft dann automatisch weiter.</p>
      )}
      {meldung && <p className="mt-1.5 text-sm text-red-600">{meldung}</p>}
    </div>
  );
}
