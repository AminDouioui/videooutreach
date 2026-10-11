'use client';

import { useEffect, useState } from 'react';
import { ortszeit } from '@/lib/time';

/** Aktuelle Ortszeit in einer Zone, z. B. „14:05 Europe/London“ (erst nach dem Laden, damit Server und Browser nicht abweichen). */
export function Ortszeit({ zone }: { zone: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const aktualisieren = () => setText(ortszeit(zone));
    aktualisieren();
    const t = setInterval(aktualisieren, 30_000);
    return () => clearInterval(t);
  }, [zone]);
  return (
    <span className="tabular-nums">
      {text ?? '–'} <span className="text-xs text-slate-400">{zone}</span>
    </span>
  );
}
