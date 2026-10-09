'use client';

import { useEffect, useState } from 'react';
import { pruefeVorlage, STANDARD_VARIABLEN } from '@/lib/vorlage';
import { platzhalterFuer } from './TemplateEditor';
import { VorlagenHinweise } from './VorlagenHilfe';

type LeadOption = { id: number; label: string };
type Schritt = { waitDays: number; body: string };
type Preview = { subject: string; html: string; text: string };

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const klein = 'rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40';

const NEUER_SCHRITT: Schritt = {
  waitDays: 3,
  body: '{{begruessung}},\n\nich wollte kurz nachhaken, ob meine letzte Nachricht bei Ihnen angekommen ist.\n\nPasst ein kurzes Gespräch in den nächsten Tagen?',
};

/**
 * Follow-ups des E-Mail-Flows: Wartezeit in Tagen + Text je Schritt. Gesendet wird als Antwort im Thread
 * der Erstmail („Re: …“); antwortet der Lead, endet sein Flow automatisch.
 */
export function FollowupEditor({
  campaignId,
  initial,
  leads,
  varianten = [],
  mitVideo,
  extraSpalten = [],
}: {
  campaignId: number;
  initial: Schritt[];
  leads: LeadOption[];
  /** Kürzel aller Varianten der Erstmail (A, B …); bei mehr als einer wählbar für die Vorschau „Re: …“ */
  varianten?: string[];
  mitVideo: boolean;
  extraSpalten?: string[];
}) {
  const [schritte, setSchritte] = useState<Schritt[]>(initial);
  const [gespeichert, setGespeichert] = useState(JSON.stringify(initial));
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  const [aktiv, setAktiv] = useState(0);
  const [leadId, setLeadId] = useState<number | null>(leads[0]?.id ?? null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // leer = Variante des Leads (bzw. die, die er bekäme)
  const [variante, setVariante] = useState('');
  const bekannt = [...STANDARD_VARIABLEN, ...extraSpalten];
  const pruefungen = schritte.map((x) => pruefeVorlage(x.body, bekannt));
  const klammerFehler = pruefungen.flatMap((p, i) => p.fehler.map((f) => `Follow-up ${i + 1}: ${f}`));
  const unbekannt = [...new Set(pruefungen.flatMap((p) => p.unbekannt))];
  const geaendert = JSON.stringify(schritte) !== gespeichert;
  const schritt = schritte[aktiv];

  // Live-Vorschau des gewählten Follow-ups
  useEffect(() => {
    if (leadId === null || !schritt) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/mail-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variante: variante || undefined, followupBody: schritt.body, followupNr: aktiv + 1 }),
          signal: ctrl.signal,
        });
        if (res.ok) setPreview(await res.json());
      } catch {
        // abgebrochen oder offline – nächste Änderung lädt neu
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [leadId, schritt, variante, aktiv]);

  function aendern(i: number, patch: Partial<Schritt>) {
    setSchritte((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function hinzufuegen() {
    setSchritte((s) => [...s, { ...NEUER_SCHRITT }]);
    setAktiv(schritte.length);
  }
  function entfernen(i: number) {
    if (!confirm(`Follow-up ${i + 1} entfernen?`)) return;
    setSchritte((s) => s.filter((_, j) => j !== i));
    setAktiv((a) => Math.max(0, a >= i ? a - 1 : a));
  }
  function verschieben(i: number, d: -1 | 1) {
    setSchritte((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
    setAktiv(i + d);
  }

  async function speichern() {
    setStatus(null);
    const res = await fetch(`/api/campaigns/${campaignId}/followups`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followups: schritte }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setGespeichert(JSON.stringify(schritte));
      const w: string[] = data.warnungen ?? [];
      setStatus({ text: w.length ? `Gespeichert (${w.join(', ')})` : 'Gespeichert', fehler: false });
    } else setStatus({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  // Tag, an dem der Schritt frühestens nach der Erstmail rausgeht
  const tagNach = (i: number) => schritte.slice(0, i + 1).reduce((s, x) => s + x.waitDays, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        {schritte.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            Noch keine Follow-ups – es wird nur die Erstmail gesendet.
          </p>
        )}
        {schritte.map((s, i) => (
          <div
            key={i}
            onClick={() => setAktiv(i)}
            className={`rounded-lg border bg-white p-4 ${aktiv === i ? 'border-indigo-600 ring-1 ring-indigo-600' : 'border-slate-200'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Follow-up {i + 1}</h3>
              <span className="text-xs text-slate-500">frühestens Tag {tagNach(i)} nach der Erstmail</span>
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={(e) => (e.stopPropagation(), verschieben(i, -1))} disabled={i === 0} className={klein} aria-label="Nach oben">
                  ▲
                </button>
                <button type="button" onClick={(e) => (e.stopPropagation(), verschieben(i, 1))} disabled={i === schritte.length - 1} className={klein} aria-label="Nach unten">
                  ▼
                </button>
                <button type="button" onClick={(e) => (e.stopPropagation(), entfernen(i))} className={`${klein} text-red-700`}>
                  Entfernen
                </button>
              </span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              Warten
              <input
                type="number"
                min={1}
                max={60}
                value={s.waitDays}
                onChange={(e) => aendern(i, { waitDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              Tag(e) nach der vorherigen Mail, falls keine Antwort
            </label>
            <textarea value={s.body} onChange={(e) => aendern(i, { body: e.target.value })} onFocus={() => setAktiv(i)} rows={7} className={`${feld} font-mono`} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={hinzufuegen} disabled={schritte.length >= 10} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            + Follow-up hinzufügen
          </button>
          <button onClick={speichern} disabled={!geaendert || klammerFehler.length > 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            Follow-ups speichern
          </button>
          {status && <span className={`text-sm ${status.fehler ? 'text-red-600' : 'text-green-700'}`}>{status.text}</span>}
        </div>
        <VorlagenHinweise fehler={klammerFehler} unbekannt={unbekannt} />
        <p className="text-xs text-slate-500">
          Platzhalter wie in der Erstmail: {platzhalterFuer(mitVideo, extraSpalten).map(([p]) => p).join(' ')}. Follow-ups gehen als Antwort im selben Thread raus (Betreff „Re: …“). Antwortet ein Lead oder kommt die Mail
          zurück, endet sein Flow automatisch. Tageslimit, Versandfenster und Abstand gelten auch für Follow-ups.
        </p>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Vorschau Follow-up {schritt ? aktiv + 1 : '–'} für</span>
          <select value={leadId ?? ''} onChange={(e) => setLeadId(Number(e.target.value))} disabled={leads.length === 0} className="min-w-0 max-w-full flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm">
            {leads.length === 0 && <option>Keine Leads vorhanden</option>}
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          {varianten.length > 1 && (
            <select value={variante} onChange={(e) => setVariante(e.target.value)} aria-label="Variante der Erstmail" className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="">Variante des Leads</option>
              {varianten.map((k) => (
                <option key={k} value={k}>
                  Betreff von Variante {k}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-sm">
            <span className="text-slate-500">Betreff: </span>
            <strong>{schritt ? (preview?.subject ?? '–') : '–'}</strong>
          </div>
          <iframe title="Follow-up-Vorschau" sandbox="" srcDoc={schritt ? (preview?.html ?? '') : ''} className="h-[420px] w-full rounded-b-lg bg-white" />
        </div>
      </div>
    </div>
  );
}
