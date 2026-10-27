'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from './CopyButton';

type Props = { id: number; kategorie: string; an: string; betreff: string; text: string; mailto: string; erledigt: boolean; schreiben: boolean };

/** Weiterleitungs-Entwurf der Vertretung: Empfänger, Betreff, Text, Kopieren, im Mailprogramm öffnen, als erledigt markieren. */
export function VertretungsEntwurf({ id, kategorie, an, betreff, text, mailto, erledigt, schreiben }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function umschalten() {
    setBusy(true);
    try {
      await fetch(`/api/vertretung/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erledigt: !erledigt }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`rounded-md border p-3 text-sm ${erledigt ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'}`}>
      <p className="flex flex-wrap items-center gap-2 font-medium">
        Weiterleitungs-Entwurf
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300">{kategorie}</span>
        {erledigt && <span className="text-xs font-normal text-slate-500">erledigt</span>}
      </p>
      <dl className="mt-2 space-y-1">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-slate-500">An</dt>
          <dd className="min-w-0 break-words">{an}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-slate-500">Betreff</dt>
          <dd className="min-w-0 break-words">{betreff}</dd>
        </div>
      </dl>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-sans text-xs ring-1 ring-slate-200">{text}</pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href={mailto} className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700">
          Im Mailprogramm öffnen
        </a>
        <CopyButton text={text} label="Text kopieren" />
        <CopyButton text={an} label="Empfänger kopieren" />
        {schreiben && (
          <button onClick={umschalten} disabled={busy} className="ml-auto rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {erledigt ? 'Wieder öffnen' : 'Als erledigt markieren'}
          </button>
        )}
      </div>
    </div>
  );
}
