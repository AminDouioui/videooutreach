'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const btn = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

/** Aktionen des Lead-Details: neu rendern, jetzt senden, überspringen, löschen. */
export function LeadActions({ leadId, campaignId, sendStatus }: { leadId: number; campaignId: number; sendStatus: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);

  async function ausfuehren(name: string, url: string, init: RequestInit, erfolg: string, bestaetigung?: string) {
    if (bestaetigung && !window.confirm(bestaetigung)) return;
    setBusy(name);
    setMeldung(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(res.status === 404 ? 'Funktion noch nicht verfügbar (404)' : (j?.error ?? `Fehler ${res.status}`));
      }
      if (name === 'loeschen') {
        router.push(`/kampagnen/${campaignId}`);
        router.refresh();
        return;
      }
      setMeldung({ text: erfolg, fehler: false });
      router.refresh();
    } catch (e) {
      setMeldung({ text: e instanceof Error ? e.message : 'Unbekannter Fehler', fehler: true });
    } finally {
      setBusy(null);
    }
  }

  const json = { 'Content-Type': 'application/json' };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!!busy} onClick={() => ausfuehren('render', `/api/leads/${leadId}/render`, { method: 'POST' }, 'Video wird neu gerendert.', 'Video neu rendern? Das bestehende Video wird ersetzt.')}>
          Video neu rendern
        </button>
        <button className={btn} disabled={!!busy || sendStatus === 'gesendet'} onClick={() => ausfuehren('senden', `/api/leads/${leadId}/send`, { method: 'POST' }, 'Mail wurde versendet.', 'Mail jetzt an diesen Lead senden?')}>
          Jetzt senden
        </button>
        <button className={btn} disabled={!!busy || sendStatus === 'uebersprungen'} onClick={() => ausfuehren('skip', `/api/leads/${leadId}`, { method: 'PATCH', headers: json, body: JSON.stringify({ sendStatus: 'uebersprungen' }) }, 'Lead wird übersprungen.')}>
          Überspringen
        </button>
        <button className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={!!busy} onClick={() => ausfuehren('loeschen', `/api/leads/${leadId}`, { method: 'DELETE' }, '', 'Lead wirklich löschen? Events, Video und Vorschaubild werden unwiderruflich entfernt.')}>
          Löschen
        </button>
      </div>
      {meldung && <p className={`mt-2 text-sm ${meldung.fehler ? 'text-red-700' : 'text-green-700'}`}>{meldung.text}</p>}
    </div>
  );
}

export function NotizFeld({ leadId, initial }: { leadId: number; initial: string }) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  async function speichern() {
    setStatus('saving');
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notizen: text }) });
      setStatus(res.ok ? 'saved' : 'error');
    } catch {
      setStatus('error');
    }
  }
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus('idle');
        }}
        rows={5}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        placeholder="Interne Notizen zu diesem Lead"
      />
      <div className="mt-2 flex items-center gap-3">
        <button onClick={speichern} disabled={status === 'saving'} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          Speichern
        </button>
        {status === 'saved' && <span className="text-sm text-green-700">Gespeichert</span>}
        {status === 'error' && <span className="text-sm text-red-700">Speichern fehlgeschlagen</span>}
      </div>
    </div>
  );
}

type Vorschau = { subject: string; html: string; text: string };

export function MailVorschau({ leadId }: { leadId: number }) {
  const [daten, setDaten] = useState<Vorschau | null>(null);
  const [fehler, setFehler] = useState(false);
  const [laedt, setLaedt] = useState(true);
  useEffect(() => {
    let aktiv = true;
    fetch(`/api/leads/${leadId}/mail-preview`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as Vorschau;
      })
      .then((d) => aktiv && setDaten(d))
      .catch(() => aktiv && setFehler(true))
      .finally(() => aktiv && setLaedt(false));
    return () => {
      aktiv = false;
    };
  }, [leadId]);

  if (laedt) return <p className="text-sm text-slate-500">Lade Vorschau …</p>;
  if (fehler || !daten) return <p className="text-sm text-slate-500">Mail-Vorschau nicht verfügbar</p>;
  return (
    <div>
      <p className="mb-2 text-sm">
        <span className="text-slate-500">Betreff:</span> <span className="font-medium">{daten.subject}</span>
      </p>
      <iframe title="Mail-Vorschau" sandbox="" srcDoc={daten.html} className="h-96 w-full rounded-md border border-slate-200 bg-white" />
    </div>
  );
}
