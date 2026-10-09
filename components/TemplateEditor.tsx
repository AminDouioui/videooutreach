'use client';

import { useEffect, useRef, useState } from 'react';
import { pruefeVorlage, STANDARD_VARIABLEN } from '@/lib/vorlage';
import { VorlagenHinweise } from './VorlagenHilfe';

type LeadOption = { id: number; label: string };
type Preview = { subject: string; html: string; text: string };

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
export const PLATZHALTER: [string, string][] = [
  ['{{begruessung}}', 'Guten Tag Max Mustermann'],
  ['{{anrede}}', 'Anrede (meist leer)'],
  ['{{vorname}}', 'Vorname'],
  ['{{nachname}}', 'Nachname'],
  ['{{name}}', 'Vor- und Nachname'],
  ['{{firma}}', 'Firmenname'],
  ['{{position}}', 'Position / Funktion'],
  ['{{website}}', 'Website'],
  ['{{email}}', 'E-Mail-Adresse des Leads'],
  ['{{absender_name}}', 'Dein Absendername (Einstellungen)'],
  ['{{video_link}}', 'Link zur Video-Seite'],
  ['{{vorschaubild}}', 'Klickbares Vorschaubild + Textlink'],
];

/** Platzhalter, die zur Kampagne passen (Text-Kampagnen ohne Video-Platzhalter) */
export function platzhalterFuer(mitVideo: boolean, extraSpalten: string[] = []): [string, string][] {
  const basis = mitVideo ? PLATZHALTER : PLATZHALTER.filter(([p]) => p !== '{{video_link}}' && p !== '{{vorschaubild}}');
  const extra = extraSpalten.filter((e) => !STANDARD_VARIABLEN.includes(e as (typeof STANDARD_VARIABLEN)[number])).map((e): [string, string] => [`{{${e}}}`, 'Eigene Spalte aus dem Import']);
  return [...basis, ...extra];
}

export function TemplateEditor({
  campaignId,
  subject: s0,
  body: b0,
  leads,
  senderEmail,
  mitVideo = true,
  extraSpalten = [],
}: {
  campaignId: number;
  subject: string;
  body: string;
  leads: LeadOption[];
  senderEmail: string;
  mitVideo?: boolean;
  /** Normalisierte Extra-Spalten der Kampagne (aus den Leads) */
  extraSpalten?: string[];
}) {
  const [subject, setSubject] = useState(s0);
  const [body, setBody] = useState(b0);
  const [leadId, setLeadId] = useState<number | null>(leads[0]?.id ?? null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [vorschauFehler, setVorschauFehler] = useState('');
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  const [tab, setTab] = useState<'html' | 'text'>('html');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [gespeichert, setGespeichert] = useState({ subject: s0, body: b0 });
  const bekannt = [...STANDARD_VARIABLEN, ...extraSpalten];
  const pruefBetreff = pruefeVorlage(subject, bekannt);
  const pruefText = pruefeVorlage(body, bekannt);
  const klammerFehler = [...pruefBetreff.fehler.map((f) => `Betreff: ${f}`), ...pruefText.fehler.map((f) => `Text: ${f}`)];
  const unbekannt = [...new Set([...pruefBetreff.unbekannt, ...pruefText.unbekannt])];
  const geaendert = subject !== gespeichert.subject || body !== gespeichert.body;

  // Live-Vorschau (entprellt) mit der aktuellen, auch ungespeicherten Vorlage
  useEffect(() => {
    if (leadId === null) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/mail-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, body }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error('Vorschau nicht verfügbar');
        setPreview(await res.json());
        setVorschauFehler('');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setVorschauFehler('Vorschau konnte nicht geladen werden');
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [leadId, subject, body]);

  function einfuegen(p: string) {
    const el = bodyRef.current;
    if (!el) return setBody((b) => b + p);
    const { selectionStart: a, selectionEnd: e } = el;
    setBody(body.slice(0, a) + p + body.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + p.length, a + p.length);
    });
  }

  async function speichern() {
    setStatus(null);
    const res = await fetch(`/api/campaigns/${campaignId}/template`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, body }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const w: string[] = data.warnungen ?? [];
      setStatus({ text: w.length ? `Gespeichert (${w.join(', ')})` : 'Gespeichert', fehler: false });
      setGespeichert({ subject, body });
    } else setStatus({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  async function testmail() {
    setStatus({ text: 'Testmail wird gesendet …', fehler: false });
    if (geaendert) await speichern();
    const res = await fetch(`/api/campaigns/${campaignId}/test-mail`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: leadId ?? undefined }) });
    const data = await res.json().catch(() => ({}));
    setStatus(data.ok ? { text: `Testmail an ${data.to} gesendet`, fehler: false } : { text: data.error ?? 'Testmail fehlgeschlagen', fehler: true });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Betreff
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={feld} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Text
          <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={14} className={`${feld} font-mono`} />
        </label>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Platzhalter (Klick fügt ein)</p>
          <div className="flex flex-wrap gap-1.5">
            {platzhalterFuer(mitVideo, extraSpalten).map(([p, hilfe]) => (
              <button key={p} type="button" title={hilfe} onClick={() => einfuegen(p)} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-50">
                {p}
              </button>
            ))}
          </div>
          <VorlagenHinweise fehler={klammerFehler} unbekannt={unbekannt} />
          <p className="mt-2 text-xs text-slate-500">Signatur (Einstellungen) und Abmeldelink werden automatisch angehängt.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={speichern} disabled={!geaendert || klammerFehler.length > 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            Speichern
          </button>
          <button onClick={testmail} disabled={leadId === null} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Testmail an mich senden
          </button>
          {status && <span className={`text-sm ${status.fehler ? 'text-red-600' : 'text-green-700'}`}>{status.text}</span>}
        </div>
        <p className="text-xs text-slate-500">Testmail geht an {senderEmail || 'SENDER_EMAIL (nicht gesetzt)'} mit „[TEST]“ im Betreff.</p>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="lead">Vorschau für</label>
          <select id="lead" value={leadId ?? ''} onChange={(e) => setLeadId(Number(e.target.value))} disabled={leads.length === 0} className="min-w-0 max-w-full flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm">
            {leads.length === 0 && <option>Keine Leads vorhanden</option>}
            {leads.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-sm">
            <span className="text-slate-500">Betreff: </span>
            <strong>{preview?.subject ?? '–'}</strong>
          </div>
          <div className="flex gap-1 border-b border-slate-200 px-2 pt-1 text-xs">
            {(['html', 'text'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-t px-3 py-1.5 font-medium ${tab === t ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
                {t === 'html' ? 'HTML' : 'Klartext'}
              </button>
            ))}
          </div>
          {vorschauFehler && <p className="p-3 text-sm text-red-600">{vorschauFehler}</p>}
          {tab === 'html' ? (
            <iframe title="Mail-Vorschau" sandbox="" srcDoc={preview?.html ?? ''} className="h-[560px] w-full rounded-b-lg bg-white" />
          ) : (
            <pre className="h-[560px] overflow-auto whitespace-pre-wrap p-3 text-sm text-slate-800">{preview?.text}</pre>
          )}
        </div>
        {mitVideo && <p className="mt-1 text-xs text-slate-500">Das Vorschaubild erscheint, sobald das Video des Leads gerendert ist.</p>}
      </div>
    </div>
  );
}
