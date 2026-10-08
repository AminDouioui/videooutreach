'use client';

import { useState } from 'react';

export function CopyButton({ text, label = 'Kopieren' }: { text: string; label?: string }) {
  const [kopiert, setKopiert] = useState(false);
  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback für unsichere Kontexte (http)
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setKopiert(true);
    setTimeout(() => setKopiert(false), 1500);
  }
  return (
    <button onClick={kopieren} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
      {kopiert ? 'Kopiert' : label}
    </button>
  );
}
