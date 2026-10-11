'use client';

import { useState } from 'react';
import type { BrainErgebnis } from '@/lib/brain';

// Aufklappbarer Bereich „Aus dem Brain“ (Lead-Detail und Unibox): Lead-Notizen, Felder und letzte Kundendokumente aus dem Brain
// (nur lesend). Alles wird als reiner Text angezeigt (React-escaped), nichts davon wird als HTML gerendert. Geladen wird beim
// ersten Aufklappen oder per Button; das Brain-Ergebnis steht 10 Minuten im Speicher des Servers.

const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
type Antwort = { ok: boolean; error?: string } & BrainErgebnis;

export function BrainKontext({ leadId, aktiv }: { leadId: number; aktiv: boolean }) {
  const [laedt, setLaedt] = useState(false);
  const [antwort, setAntwort] = useState<BrainErgebnis | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  if (!aktiv) return null;

  async function laden(frisch: boolean) {
    setLaedt(true);
    setFehler(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/brain-kontext${frisch ? '?frisch=1' : ''}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({ ok: false }))) as Antwort;
      if (!res.ok || data.ok === false) setFehler(data.error ?? `Der Brain-Kontext konnte nicht geladen werden (Fehler ${res.status}).`);
      else setAntwort(data);
    } catch {
      setFehler('Der Brain-Kontext konnte nicht geladen werden: keine Verbindung zum Server.');
    } finally {
      setLaedt(false);
    }
  }

  const d = antwort?.status === 'ok' ? antwort.daten : null;
  return (
    <details
      className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
      data-testid="brain-kontext"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !antwort && !laedt) void laden(false);
      }}
    >
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">Aus dem Brain</summary>
      <div className="mt-2 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void laden(true)} disabled={laedt} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {laedt ? 'Wird geladen …' : antwort ? 'Neu laden' : 'Aus dem Brain laden'}
          </button>
          {antwort?.status === 'ok' && <span className="text-xs text-slate-500">Stand {zeit.format(new Date(antwort.geladenAt))}{antwort.ausCache ? ' (zwischengespeichert)' : ''}</span>}
        </div>
        {fehler && (
          <p role="alert" className="text-sm text-red-700">
            {fehler}
          </p>
        )}
        {antwort?.status === 'nicht_konfiguriert' && <p className="text-xs text-slate-500">Das Brain ist nicht verbunden (Einstellungen → Integrationen).</p>}
        {antwort?.status === 'fehler' && (
          <p role="alert" className="text-sm text-amber-800" data-testid="brain-fehler">
            Das Brain konnte nicht abgefragt werden: {antwort.meldung}
          </p>
        )}
        {d && !d.gefunden && <p className="text-xs text-slate-500" data-testid="brain-leer">Im Brain wurde nichts zu diesem Lead gefunden.</p>}
        {d?.lead && (
          <section className="space-y-1.5" aria-label="Lead im Brain">
            <h3 className="text-xs font-semibold text-slate-700">Lead-Notiz{d.lead.firma ? `: ${d.lead.firma}` : ''}</h3>
            <p className="flex flex-wrap gap-x-3 text-xs text-slate-600">
              {d.lead.status && <span>Status: {d.lead.status}</span>}
              {d.lead.score && <span>Score: {d.lead.score}</span>}
              {d.lead.datei && <span className="break-all font-mono">{d.lead.datei}</span>}
            </p>
            {d.lead.felder.length > 0 && (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
                {d.lead.felder.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="break-words text-slate-800">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {d.lead.notizen && <p className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-2 text-xs text-slate-800">{d.lead.notizen}</p>}
          </section>
        )}
        {d?.kunde && (
          <section className="space-y-1.5" aria-label="Kundendokumente im Brain">
            <h3 className="text-xs font-semibold text-slate-700">
              Kunde <span className="break-all font-mono font-normal text-slate-500">{d.kunde.ordner}</span>
            </h3>
            {d.kunde.dokumente.length === 0 && <p className="text-xs text-slate-500">Keine Dokumente.</p>}
            <ul className="space-y-2">
              {d.kunde.dokumente.map((x, i) => (
                <li key={`${x.datei}-${i}`} className="rounded border border-slate-200 bg-white p-2 text-xs">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    {x.datum && <span className="font-medium text-slate-700">{x.datum}</span>}
                    {x.titel && <span className="break-words font-medium text-slate-900">{x.titel}</span>}
                  </p>
                  {x.datei && <p className="break-all font-mono text-slate-500">{x.datei}</p>}
                  {x.auszug && <p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{x.auszug}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {d && <p className="text-xs text-slate-400">Intern, nur lesend. Der Kontext wird beim „Entwurf mit KI“ an den gewählten KI-Anbieter übertragen.</p>}
      </div>
    </details>
  );
}
