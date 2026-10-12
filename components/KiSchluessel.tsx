'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type KiAnbieterId = 'typesafe' | 'openrouter' | 'openai' | 'anthropic';
export type SchluesselStatus = { gesetzt: boolean; quelle: 'app' | 'env' | null; maske: string | null; appGespeichert: boolean };

const ANBIETER: { id: KiAnbieterId; name: string; label: string; zweck: string; hinweis: string; link: string; linkText: string; optional?: boolean; erklaerung?: string }[] = [
  {
    id: 'typesafe',
    name: 'TypeSafe (Jev, direkt)',
    label: 'TypeSafe-API-Schlüssel (Jev direkt, von console.typesafe.ai)',
    zweck: 'für die Einordnung',
    hinweis: 'Schlüssel erstellen unter',
    link: 'https://console.typesafe.ai',
    linkText: 'console.typesafe.ai',
    erklaerung: 'Schlüssel direkt von TypeSafe kommt in dieses Feld, ein Schlüssel von OpenRouter (sk-or-…) in das OpenRouter-Feld darunter. Sind beide gesetzt, wird TypeSafe direkt verwendet.',
  },
  { id: 'openrouter', name: 'OpenRouter (Jev)', label: 'OpenRouter-API-Schlüssel (sk-or-…)', zweck: 'für die Einordnung', hinweis: 'Schlüssel erstellen unter', link: 'https://openrouter.ai/keys', linkText: 'openrouter.ai/keys' },
  { id: 'openai', name: 'OpenAI', label: 'OpenAI-API-Schlüssel', zweck: 'für Entwürfe und Textvorschläge', hinweis: 'Schlüssel erstellen unter', link: 'https://platform.openai.com/api-keys', linkText: 'platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Claude (Anthropic)', label: 'Claude-API-Schlüssel (Anthropic)', zweck: 'optional, für Einordnung und Texte', hinweis: 'Schlüssel erstellen in der', link: 'https://console.anthropic.com/', linkText: 'console.anthropic.com', optional: true },
];

/** Sanfter Hinweis (blockiert nichts), wenn der Schlüssel zum falschen Feld zu gehören scheint */
export function warnung(id: KiAnbieterId, wert: string): string | null {
  const w = wert.trim();
  if (!w) return null;
  if (id === 'typesafe' && w.startsWith('sk-or-')) return 'Dieser Schlüssel beginnt mit „sk-or-“ und stammt wohl von OpenRouter. Bitte in das OpenRouter-Feld eintragen; bei TypeSafe direkt wird er abgelehnt (401).';
  if (id === 'openrouter' && !w.startsWith('sk-or-')) return 'OpenRouter-Schlüssel beginnen mit „sk-or-“. Stammt dieser Schlüssel von TypeSafe (console.typesafe.ai), bitte in das Feld „TypeSafe (Jev, direkt)“ eintragen.';
  return null;
}

const QUELLE = { app: 'in der App gespeichert', env: 'aus .env' } as const;
const feld = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopf = 'rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * KI-Schlüssel (Einstellungen → KI). Admins tragen sie hier ein (verschlüsselt gespeichert, nur die letzten 4 Zeichen
 * kommen zurück); alle anderen sehen nur „gesetzt: ja/nein“. Die Berechtigung prüfen die API-Routen serverseitig.
 */
export function KiSchluessel({ initial, istAdmin }: { initial: Record<KiAnbieterId, SchluesselStatus>; istAdmin: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [eingabe, setEingabe] = useState<Record<KiAnbieterId, string>>({ typesafe: '', openrouter: '', openai: '', anthropic: '' });
  const [meldung, setMeldung] = useState<Partial<Record<KiAnbieterId, { text: string; fehler: boolean }>>>({});
  const [laeuft, setLaeuft] = useState<KiAnbieterId | null>(null);

  const zeige = (id: KiAnbieterId, text: string, fehler: boolean) => setMeldung((m) => ({ ...m, [id]: { text, fehler } }));

  async function aufruf(id: KiAnbieterId, url: string, method: string, body: unknown) {
    setLaeuft(id);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    } catch {
      return { res: null, data: {} as Record<string, unknown> };
    } finally {
      setLaeuft(null);
    }
  }

  async function speichern(id: KiAnbieterId) {
    if (!eingabe[id].trim()) return zeige(id, 'Bitte einen Schlüssel eingeben.', true);
    const { res, data } = await aufruf(id, '/api/settings/ki-schluessel', 'PUT', { anbieter: id, schluessel: eingabe[id] });
    if (res?.ok) {
      setStatus(data.kiSchluessel);
      setEingabe((e) => ({ ...e, [id]: '' }));
      zeige(id, 'Gespeichert', false);
      router.refresh();
    } else zeige(id, res ? ((data.error as string) ?? 'Speichern fehlgeschlagen') : 'Keine Verbindung zum Server', true);
  }

  async function entfernen(id: KiAnbieterId) {
    const { res, data } = await aufruf(id, '/api/settings/ki-schluessel', 'DELETE', { anbieter: id });
    if (res?.ok) {
      setStatus(data.kiSchluessel);
      zeige(id, status[id].quelle === 'app' && data.kiSchluessel[id].gesetzt ? 'Entfernt – es gilt der Wert aus der .env' : 'Entfernt', false);
      router.refresh();
    } else zeige(id, res ? ((data.error as string) ?? 'Entfernen fehlgeschlagen') : 'Keine Verbindung zum Server', true);
  }

  async function testen(id: KiAnbieterId) {
    zeige(id, 'Prüfe …', false);
    const { res, data } = await aufruf(id, '/api/settings/ki-schluessel/test', 'POST', { anbieter: id, schluessel: eingabe[id].trim() || undefined });
    if (res) zeige(id, (data.meldung as string) ?? (data.error as string) ?? 'Test fehlgeschlagen', !data.ok);
    else zeige(id, 'Keine Verbindung', true);
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5" aria-label="KI-Schlüssel">
      <div>
        <h2 className="text-base font-semibold">KI-Schlüssel</h2>
        <p className="mt-1 text-xs text-slate-500">
          Ohne Schlüssel sind die KI-Funktionen aus und unsichtbar. Schlüssel werden hier verschlüsselt gespeichert und gelten sofort, ohne Neustart. Alternativ können sie weiterhin in der <span className="font-mono">.env</span> stehen; ein hier gespeicherter Wert hat Vorrang.
        </p>
      </div>
      <ul className="space-y-4">
        {ANBIETER.map((a) => {
          const s = status[a.id];
          const m = meldung[a.id];
          const busy = laeuft === a.id;
          return (
            <li key={a.id} className="space-y-2 rounded-md border border-slate-200 p-3" data-anbieter={a.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-sm font-medium text-slate-800">
                  {a.name} <span className="font-normal text-slate-500">– {a.zweck}</span>
                </h3>
                <span className={`text-xs ${s.gesetzt ? 'text-green-700' : 'text-slate-500'}`} data-testid={`status-${a.id}`}>
                  {istAdmin
                    ? s.gesetzt
                      ? `gesetzt${s.maske ? ` (${s.maske})` : ''} · ${QUELLE[s.quelle ?? 'env']}`
                      : 'nicht gesetzt'
                    : `Schlüssel gesetzt: ${s.gesetzt ? 'ja' : 'nein'}`}
                </span>
              </div>
              {istAdmin && (
                <>
                  <span className="block text-xs font-medium text-slate-700">{a.label}</span>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={a.label}
                      value={eingabe[a.id]}
                      onChange={(e) => setEingabe((x) => ({ ...x, [a.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void speichern(a.id);
                        }
                      }}
                      placeholder={s.appGespeichert ? 'Neuen Schlüssel eingeben, um ihn zu ersetzen' : 'Schlüssel einfügen'}
                      maxLength={300}
                      className={`${feld} sm:flex-1`}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void speichern(a.id)} disabled={busy || !eingabe[a.id].trim()} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                        Speichern
                      </button>
                      <button type="button" onClick={() => void entfernen(a.id)} disabled={busy || !s.appGespeichert} title={s.appGespeichert ? undefined : 'Nur in der App gespeicherte Schlüssel können entfernt werden'} className={knopf}>
                        Entfernen
                      </button>
                      <button type="button" onClick={() => void testen(a.id)} disabled={busy || (!s.gesetzt && !eingabe[a.id].trim())} className={knopf}>
                        Verbindung testen
                      </button>
                    </div>
                  </div>
                  {warnung(a.id, eingabe[a.id]) && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid={`warnung-${a.id}`}>
                      {warnung(a.id, eingabe[a.id])}
                    </p>
                  )}
                  {a.erklaerung && <p className="text-xs text-slate-600">{a.erklaerung}</p>}
                  <p className="text-xs text-slate-500">
                    {a.hinweis}{' '}
                    <a href={a.link} target="_blank" rel="noreferrer noopener" className="text-indigo-700 underline">
                      {a.linkText}
                    </a>
                    . „Verbindung testen“ prüft den eingegebenen, sonst den gespeicherten Schlüssel.
                  </p>
                  <p role="status" aria-live="polite" className={`min-h-4 text-sm ${m?.fehler ? 'text-red-600' : 'text-green-700'}`} data-testid={`meldung-${a.id}`}>
                    {m?.text}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>Datenschutz:</strong> Für die KI-Funktionen werden Mailtexte (Antworten der Leads, Thread-Verlauf, Ihre Beschreibungen) an den gewählten Anbieter übertragen: bei Claude an Anthropic, bei Jev an TypeSafe (direkt oder über OpenRouter), bei OpenAI an OpenAI (jeweils USA).
        Bitte vorher einen Auftragsverarbeitungsvertrag (AVV/DPA) mit dem Anbieter prüfen bzw. abschließen und die Datenschutzerklärung anpassen. Ohne Schlüssel sind alle KI-Funktionen aus.
      </p>
    </section>
  );
}
