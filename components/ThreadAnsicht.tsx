'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ThreadNachricht } from '@/lib/mail-parse';
import { KiEntwurfKnopf } from './KiKomponenten';

const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });

type Antwort = { ok: boolean; error?: string; threadId?: string; nachrichten?: ThreadNachricht[] };

/**
 * Verlauf eines Leads (Unibox): Nachrichten als reiner Text (nie HTML, React-escaped, keine Links/Bilder werden geladen),
 * eigene und fremde Nachrichten unterscheidbar, zitierter Verlauf einklappbar, optional Antwortfeld.
 * Lädt per GET /api/leads/[id]/thread, antwortet per POST /api/leads/[id]/antworten.
 */
export function ThreadAnsicht({
  leadId,
  threads,
  start,
  antwortenErlaubt,
  postfachEmail,
  gmailUrl,
  kiAktiv = false,
}: {
  leadId: number;
  threads: string[];
  start: number;
  antwortenErlaubt: boolean;
  postfachEmail: string;
  /** Fallback-Link in Gmail (bei Fehlern) */
  gmailUrl: string | null;
  /** KI-Funktionen verfügbar (ANTHROPIC_API_KEY gesetzt) */
  kiAktiv?: boolean;
}) {
  const [index, setIndex] = useState(Math.min(start, Math.max(threads.length - 1, 0)));
  const [nachrichten, setNachrichten] = useState<ThreadNachricht[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(threads.length > 0);
  const [neuLaden, setNeuLaden] = useState(0);
  const [text, setText] = useState('');
  const [sendet, setSendet] = useState(false);
  const [sendFehler, setSendFehler] = useState<string | null>(null);
  const [gesendet, setGesendet] = useState(false);
  const threadId = threads[index];

  useEffect(() => {
    if (!threadId) return;
    const ctrl = new AbortController();
    setLaedt(true);
    setFehler(null);
    fetch(`/api/leads/${leadId}/thread?thread=${encodeURIComponent(threadId)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as Antwort;
        if (ctrl.signal.aborted) return;
        if (data.ok && data.nachrichten) setNachrichten(data.nachrichten);
        else {
          setNachrichten(null);
          setFehler(data.error ?? `Der Verlauf konnte nicht geladen werden (Fehler ${res.status}).`);
        }
        setLaedt(false);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setNachrichten(null);
        setFehler('Der Verlauf konnte nicht geladen werden – keine Verbindung zum Server. Bitte erneut versuchen.');
        setLaedt(false);
      });
    return () => ctrl.abort();
  }, [leadId, threadId, neuLaden]);

  const senden = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!text.trim() || sendet) return;
      setSendet(true);
      setSendFehler(null);
      setGesendet(false);
      try {
        const res = await fetch(`/api/leads/${leadId}/antworten`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, threadId }) });
        const data = (await res.json().catch(() => ({}))) as Antwort;
        if (res.ok && data.ok) {
          setText('');
          setGesendet(true);
          setNeuLaden((n) => n + 1);
        } else setSendFehler(data.error ?? `Senden fehlgeschlagen (Fehler ${res.status}).`);
      } catch {
        setSendFehler('Senden fehlgeschlagen – keine Verbindung zum Server. Der Text bleibt erhalten.');
      } finally {
        setSendet(false);
      }
    },
    [leadId, text, threadId, sendet],
  );

  if (threads.length === 0) return <p className="text-sm text-slate-500">Zu diesem Lead gibt es noch keinen Gmail-Thread.</p>;

  return (
    <div className="space-y-3">
      {threads.length > 1 && (
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Threads des Leads">
          {threads.map((t, i) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => {
                setIndex(i);
                setNachrichten(null);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${i === index ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'}`}
            >
              Thread {i + 1}
            </button>
          ))}
        </div>
      )}

      {laedt && !nachrichten && <p className="text-sm text-slate-500">Verlauf wird geladen …</p>}
      {fehler && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{fehler}</p>
          <p className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setNeuLaden((n) => n + 1)} className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100">
              Erneut versuchen
            </button>
            {gmailUrl && (
              <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-indigo-700 hover:underline">
                In Gmail öffnen
              </a>
            )}
          </p>
        </div>
      )}

      {nachrichten && (
        <ol className="space-y-3" aria-label="Verlauf">
          {nachrichten.length === 0 && <li className="text-sm text-slate-500">Der Thread enthält keine Nachrichten.</li>}
          {nachrichten.map((n) => (
            <li
              key={n.id}
              data-eigene={n.eigene ? 'ja' : 'nein'}
              className={`rounded-lg border p-3 text-sm ${n.eigene ? 'ml-4 border-indigo-200 bg-indigo-50 sm:ml-10' : 'mr-4 border-slate-200 bg-white sm:mr-10'}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-slate-500">
                <span className="min-w-0 break-words">
                  <strong className={n.eigene ? 'text-indigo-800' : 'text-slate-700'}>{n.eigene ? `Du (${postfachEmail})` : n.von || 'Unbekannt'}</strong>
                  {n.an && <span> → {n.an}</span>}
                </span>
                <time>{n.datum ? zeit.format(new Date(n.datum)) : ''}</time>
              </div>
              {n.betreff && <p className="mt-1 break-words text-xs font-medium text-slate-600">{n.betreff}</p>}
              <p className="mt-2 whitespace-pre-wrap break-words text-slate-900">{n.text || <span className="text-slate-400">(kein Text)</span>}</p>
              {n.zitat && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">Zitierten Verlauf anzeigen</summary>
                  <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-slate-300 pl-3 text-xs text-slate-500">{n.zitat}</p>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}

      {antwortenErlaubt && (
        <form onSubmit={senden} className="space-y-2 border-t border-slate-200 pt-3">
          <label className="block text-sm font-medium text-slate-700" htmlFor={`antwort-${leadId}`}>
            Antwort
          </label>
          <textarea
            id={`antwort-${leadId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={20000}
            placeholder="Antwort schreiben …"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={sendet || !text.trim()} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {sendet ? 'Wird gesendet …' : 'Antwort senden'}
            </button>
            <KiEntwurfKnopf aktiv={kiAktiv} leadId={leadId} vorhandenerText={text} onEntwurf={setText} />
            <span className="text-xs text-slate-500">Geht im selben Thread über {postfachEmail} raus, mit der Signatur des Postfachs (ohne Abmeldelink).</span>
          </div>
          {sendFehler && (
            <p role="alert" className="text-sm text-red-700">
              {sendFehler}
            </p>
          )}
          {gesendet && <p className="text-sm text-green-700">Antwort gesendet.</p>}
        </form>
      )}
    </div>
  );
}
