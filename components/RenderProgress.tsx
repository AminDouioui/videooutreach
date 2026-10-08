'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Status = { total: number; wartet: number; rendert: number; fertig: number; fehler: number; angefordert: number; campaignStatus: string };

/** Fortschrittsbalken „143 / 200 fertig“; pollt alle 3 s, solange Videos angefordert sind oder gerendert werden. */
export function RenderProgress({ campaignId, initial }: { campaignId: number; initial: Status }) {
  const router = useRouter();
  const [s, setS] = useState<Status>(initial);
  const vorher = useRef(initial);

  useEffect(() => {
    setS(initial);
    vorher.current = initial;
  }, [initial]);

  const aktiv = s.angefordert > 0 || s.rendert > 0;

  useEffect(() => {
    // Beim Anfordern ist die Seite evtl. schon veraltet: immer einmal pollen, dann nur bei Aktivität
    let stop = false;
    async function lade() {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const neu = (await res.json()) as Status;
        if (stop) return;
        const warAktiv = vorher.current.angefordert > 0 || vorher.current.rendert > 0;
        const istAktiv = neu.angefordert > 0 || neu.rendert > 0;
        vorher.current = neu;
        setS(neu);
        // Fertig geworden -> Tabelle serverseitig neu laden
        if (warAktiv && !istAktiv) router.refresh();
      } catch {
        // Netzwerkfehler: beim nächsten Takt erneut
      }
    }
    if (!aktiv) return;
    const t = setInterval(lade, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [aktiv, campaignId, router]);

  if (s.total === 0 || (!aktiv && s.fertig === 0 && s.fehler === 0)) return null;
  const prozent = Math.round((s.fertig / s.total) * 100);
  return (
    <div className="mb-4 rounded-md border border-slate-200 bg-white p-3" aria-live="polite">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">
          {s.fertig} / {s.total} fertig
          {aktiv && <span className="ml-2 font-normal text-slate-500">· {s.rendert} in Arbeit, {s.angefordert - s.rendert} in der Warteschlange</span>}
        </span>
        {s.fehler > 0 && <span className="text-red-600">{s.fehler} fehlgeschlagen</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-indigo-600 transition-all" style={{ width: `${prozent}%` }} />
      </div>
    </div>
  );
}
