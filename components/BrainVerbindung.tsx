'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BrainStatus } from '@/lib/brain';

const QUELLE = { app: 'in der App gespeichert', env: 'aus .env' } as const;
const feld = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopf = 'rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Brain-Anbindung (Einstellungen → Integrationen, nur Admin): URL und Token des Brains. Der Token wird verschlüsselt
 * gespeichert und kommt nie zurück, nur die Maske („…abcd“). „Verbindung testen“ ruft /api/extern/health im Brain auf.
 */
export function BrainVerbindung({ initial }: { initial: BrainStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [url, setUrl] = useState(initial.url);
  const [token, setToken] = useState('');
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function aufruf(pfad: string, method: string, body?: unknown) {
    setLaeuft(true);
    try {
      const res = await fetch(pfad, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { res, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { res: null, data: {} as Record<string, unknown> };
    } finally {
      setLaeuft(false);
    }
  }

  // Nur geänderte Felder senden (die URL nur, wenn sie von der gespeicherten abweicht)
  const urlGeaendert = url.trim() !== '' && url.trim() !== status.url;
  const eingabe = { url: urlGeaendert ? url.trim() : undefined, token: token.trim() || undefined };

  async function speichern() {
    if (!eingabe.url && !eingabe.token) return setMeldung({ text: 'Bitte URL und/oder Token ändern.', fehler: true });
    const { res, data } = await aufruf('/api/settings/brain', 'PUT', eingabe);
    if (res?.ok) {
      const s = data.brain as BrainStatus;
      setStatus(s);
      setUrl(s.url);
      setToken('');
      setMeldung({ text: 'Gespeichert', fehler: false });
      router.refresh();
    } else setMeldung({ text: res ? ((data.error as string) ?? 'Speichern fehlgeschlagen') : 'Keine Verbindung zum Server', fehler: true });
  }

  async function entfernen() {
    const { res, data } = await aufruf('/api/settings/brain', 'DELETE');
    if (res?.ok) {
      const s = data.brain as BrainStatus;
      setStatus(s);
      setUrl(s.url);
      setToken('');
      setMeldung({ text: s.verbunden ? 'Entfernt, es gilt der Wert aus der .env' : 'Entfernt', fehler: false });
      router.refresh();
    } else setMeldung({ text: res ? ((data.error as string) ?? 'Entfernen fehlgeschlagen') : 'Keine Verbindung zum Server', fehler: true });
  }

  async function testen() {
    setMeldung({ text: 'Prüfe …', fehler: false });
    const { res, data } = await aufruf('/api/settings/brain/test', 'POST', eingabe);
    if (res) setMeldung({ text: (data.meldung as string) ?? (data.error as string) ?? 'Test fehlgeschlagen', fehler: !data.ok });
    else setMeldung({ text: 'Keine Verbindung zum Server', fehler: true });
  }

  const kannTesten = (status.verbunden || (!!(eingabe.url ?? status.url) && !!(eingabe.token || status.tokenGesetzt))) && !laeuft;
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5" aria-label="Brain">
      <div>
        <h2 className="text-base font-semibold">Brain</h2>
        <p className="mt-1 text-xs text-slate-500">
          Liest zu einem Lead Notizen, Felder und die letzten Kundendokumente aus dem Brain (nur lesend). Der Kontext erscheint im Lead-Detail und in der Unibox unter „Aus dem Brain“ und fließt in den „Entwurf mit KI“ ein. Im Brain muss{' '}
          <span className="font-mono">EXTERN_API_TOKEN</span> gesetzt sein, derselbe Wert kommt hier als Token. Alternativ per <span className="font-mono">BRAIN_URL</span> und <span className="font-mono">BRAIN_API_TOKEN</span> in der <span className="font-mono">.env</span>; die Einstellung hier hat Vorrang.
        </p>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Brain-URL
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://brain.prozessia.space" autoComplete="off" spellCheck={false} maxLength={500} className={`${feld} mt-1`} />
        {status.urlQuelle && <span className="mt-1 block text-xs font-normal text-slate-500">Aktuell: {QUELLE[status.urlQuelle]}</span>}
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Token
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void speichern();
            }
          }}
          placeholder={status.tokenGesetzt ? 'Neuen Token eingeben, um ihn zu ersetzen' : 'Token einfügen'}
          maxLength={300}
          className={`${feld} mt-1`}
        />
        <span className="mt-1 block text-xs font-normal text-slate-500" data-testid="brain-token-status">
          {status.tokenGesetzt ? `Token gesetzt${status.tokenMaske ? ` (${status.tokenMaske})` : ''} · ${QUELLE[status.tokenQuelle ?? 'env']}` : 'Kein Token gesetzt'}
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void speichern()} disabled={laeuft || (!eingabe.url && !eingabe.token)} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
          Speichern
        </button>
        <button type="button" onClick={() => void testen()} disabled={!kannTesten} className={knopf}>
          Verbindung testen
        </button>
        <button type="button" onClick={() => void entfernen()} disabled={laeuft || !status.appGespeichert} title={status.appGespeichert ? undefined : 'Nur in der App gespeicherte Werte können entfernt werden'} className={knopf}>
          Entfernen
        </button>
      </div>
      <p role="status" aria-live="polite" className={`min-h-4 text-sm ${meldung?.fehler ? 'text-red-600' : 'text-green-700'}`} data-testid="brain-meldung">
        {meldung?.text}
      </p>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>Datenschutz:</strong> Beim „Entwurf mit KI“ geht der Brain-Kontext des Leads (gekürzt: Notizen, Felder, Dokumentauszüge) zusammen mit dem Mailverlauf an den gewählten KI-Anbieter (OpenAI oder Anthropic, jeweils USA). Das Brain selbst wird nur lesend abgefragt, es werden keine Daten dorthin geschrieben. Ohne Brain-Verbindung läuft alles wie bisher.
      </p>
    </section>
  );
}
