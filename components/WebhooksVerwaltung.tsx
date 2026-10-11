'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EREIGNIS_LABEL, WEBHOOK_EREIGNISSE } from '@/lib/webhook-ereignisse';
import { CopyButton } from './CopyButton';

type Zustellung = {
  id: number;
  ereignis: string;
  status: 'offen' | 'ok' | 'fehler';
  versuche: number;
  httpStatus: number | null;
  letzterFehler: string | null;
  createdAt: string;
  naechsterVersuchAt: string | null;
};
type Hook = { id: number; url: string; ereignisse: string[]; aktiv: boolean; zustellungen: Zustellung[] };

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopf = 'rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50';
const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'medium' });

const STATUS: Record<Zustellung['status'], [string, string]> = {
  ok: ['OK', 'bg-green-100 text-green-800'],
  offen: ['Offen', 'bg-amber-100 text-amber-800'],
  fehler: ['Fehler', 'bg-red-100 text-red-800'],
};

export function WebhooksVerwaltung({ webhooks, privatErlaubt }: { webhooks: Hook[]; privatErlaubt: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [gewaehlt, setGewaehlt] = useState<string[]>(['antwort', 'lead_status']);
  const [fehler, setFehler] = useState('');
  const [neuesGeheimnis, setNeuesGeheimnis] = useState<{ id: number; geheimnis: string } | null>(null);
  const [angezeigt, setAngezeigt] = useState<Record<number, string>>({});
  const [meldung, setMeldung] = useState<Record<number, string>>({});

  const umschalten = (liste: string[], e: string) => (liste.includes(e) ? liste.filter((x) => x !== e) : [...liste, e]);

  async function anlegen(e: React.FormEvent) {
    e.preventDefault();
    setFehler('');
    const res = await fetch('/api/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ereignisse: gewaehlt }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setFehler(data.error ?? 'Anlegen fehlgeschlagen');
    setUrl('');
    setNeuesGeheimnis({ id: data.id, geheimnis: data.geheimnis });
    router.refresh();
  }

  async function aufruf(id: number, pfad: string, methode: string, body?: unknown): Promise<Record<string, unknown> | null> {
    const res = await fetch(pfad, { method: methode, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMeldung((m) => ({ ...m, [id]: data.error ?? 'Aktion fehlgeschlagen' }));
      return null;
    }
    setMeldung((m) => ({ ...m, [id]: '' }));
    return data;
  }

  async function aktivUmschalten(h: Hook) {
    if (await aufruf(h.id, `/api/webhooks/${h.id}`, 'PATCH', { aktiv: !h.aktiv })) router.refresh();
  }
  async function ereignisUmschalten(h: Hook, e: string) {
    const neu = umschalten(h.ereignisse, e);
    if (neu.length === 0) return setMeldung((m) => ({ ...m, [h.id]: 'Mindestens ein Ereignis wählen' }));
    if (await aufruf(h.id, `/api/webhooks/${h.id}`, 'PATCH', { ereignisse: neu })) router.refresh();
  }
  async function loeschen(h: Hook) {
    if (!confirm(`Webhook ${h.url} samt Protokoll löschen?`)) return;
    if (await aufruf(h.id, `/api/webhooks/${h.id}`, 'DELETE')) router.refresh();
  }
  async function test(h: Hook) {
    if (await aufruf(h.id, `/api/webhooks/${h.id}/test`, 'POST')) {
      setMeldung((m) => ({ ...m, [h.id]: 'Test-Zustellung angelegt – der Worker stellt sie in wenigen Sekunden zu. Dann „Protokoll aktualisieren“.' }));
      router.refresh();
    }
  }
  async function geheimnisZeigen(h: Hook) {
    if (angezeigt[h.id]) return setAngezeigt((a) => ({ ...a, [h.id]: '' }));
    const d = await aufruf(h.id, `/api/webhooks/${h.id}/geheimnis`, 'GET');
    if (d) setAngezeigt((a) => ({ ...a, [h.id]: String(d.geheimnis) }));
  }
  async function geheimnisNeu(h: Hook) {
    if (!confirm('Neues Geheimnis erzeugen? Das alte ist sofort ungültig, der Empfänger muss das neue eintragen.')) return;
    const d = await aufruf(h.id, `/api/webhooks/${h.id}/geheimnis`, 'POST');
    if (d) setAngezeigt((a) => ({ ...a, [h.id]: String(d.geheimnis) }));
  }
  async function erneut(h: Hook, z: Zustellung) {
    if (await aufruf(h.id, `/api/webhook-zustellungen/${z.id}/erneut`, 'POST')) {
      setMeldung((m) => ({ ...m, [h.id]: 'Zustellung erneut angelegt – der Worker stellt sie in wenigen Sekunden zu.' }));
      router.refresh();
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-base font-semibold">Webhooks</h2>
      <p className="mb-3 text-xs text-slate-500">
        Bei den gewählten Ereignissen sendet der Worker einen signierten POST mit JSON an die URL (Header <code>X-Signatur</code>, bei Fehlern bis zu fünf Wiederholungen). Ziele im lokalen oder privaten Netz sind
        {privatErlaubt ? ' hier ausnahmsweise erlaubt (WEBHOOK_PRIVATE_ERLAUBT=1).' : ' aus Sicherheitsgründen nicht erlaubt.'}
      </p>

      <form onSubmit={anlegen} className="mb-5 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <label className="block text-sm font-medium text-slate-700">
          URL
          <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhook" className={feld} />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Ereignisse</legend>
          <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {WEBHOOK_EREIGNISSE.map((e) => (
              <label key={e} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={gewaehlt.includes(e)} onChange={() => setGewaehlt((g) => umschalten(g, e))} />
                <span>{EREIGNIS_LABEL[e]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {fehler && <p className="text-sm text-red-600">{fehler}</p>}
        <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Webhook anlegen
        </button>
      </form>

      {neuesGeheimnis && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Webhook angelegt. Geheimnis für die Signaturprüfung:</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{neuesGeheimnis.geheimnis}</code>
            <CopyButton text={neuesGeheimnis.geheimnis} />
          </div>
          <p className="mt-1 text-xs text-amber-800">Es bleibt über „Geheimnis anzeigen“ abrufbar.</p>
        </div>
      )}

      {webhooks.length === 0 ? (
        <p className="text-sm text-slate-500">Noch keine Webhooks angelegt.</p>
      ) : (
        <ul className="space-y-4">
          {webhooks.map((h) => (
            <li key={h.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 basis-60 break-all text-sm font-medium">{h.url}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${h.aktiv ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{h.aktiv ? 'Aktiv' : 'Inaktiv'}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {WEBHOOK_EREIGNISSE.map((e) => (
                  <label key={e} className="flex items-center gap-1 text-xs text-slate-700">
                    <input type="checkbox" checked={h.ereignisse.includes(e)} onChange={() => ereignisUmschalten(h, e)} />
                    {EREIGNIS_LABEL[e]}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => test(h)} className={knopf}>Test senden</button>
                <button onClick={() => aktivUmschalten(h)} className={knopf}>{h.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
                <button onClick={() => geheimnisZeigen(h)} className={knopf}>{angezeigt[h.id] ? 'Geheimnis verbergen' : 'Geheimnis anzeigen'}</button>
                <button onClick={() => geheimnisNeu(h)} className={knopf}>Geheimnis neu erzeugen</button>
                <button onClick={() => loeschen(h)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Löschen</button>
              </div>
              {angezeigt[h.id] && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{angezeigt[h.id]}</code>
                  <CopyButton text={angezeigt[h.id]} />
                </div>
              )}
              {meldung[h.id] && <p className="mt-2 text-sm text-slate-600">{meldung[h.id]}</p>}

              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Protokoll ({h.zustellungen.length} letzte Zustellungen)</summary>
                <div className="mt-2">
                  <button onClick={() => router.refresh()} className={knopf}>Protokoll aktualisieren</button>
                  {h.zustellungen.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Noch keine Zustellungen.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-slate-100 text-xs">
                      {h.zustellungen.map((z) => (
                        <li key={z.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                          <div className="min-w-0 flex-1 basis-56 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS[z.status][1]}`}>{STATUS[z.status][0]}</span>
                              <span className="font-medium text-slate-800">{EREIGNIS_LABEL[z.ereignis] ?? z.ereignis}</span>
                              <span className="whitespace-nowrap text-slate-500">{zeit.format(new Date(z.createdAt))}</span>
                            </div>
                            <div className="text-slate-500">
                              HTTP {z.httpStatus ?? '–'} · {z.versuche} {z.versuche === 1 ? 'Versuch' : 'Versuche'}
                              {z.status === 'offen' && z.versuche > 0 && z.naechsterVersuchAt && <> · nächster Versuch {zeit.format(new Date(z.naechsterVersuchAt))}</>}
                            </div>
                            {z.letzterFehler && <div className="break-words text-red-700">{z.letzterFehler}</div>}
                          </div>
                          <button onClick={() => erneut(h, z)} className="whitespace-nowrap font-medium text-indigo-600 hover:underline">
                            Erneut senden
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
