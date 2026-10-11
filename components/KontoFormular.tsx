'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopf = 'rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';

/** „Mein Konto“: Name ändern, Passwort ändern (bisheriges Passwort nötig). */
export function KontoFormular({ name: start }: { name: string }) {
  const router = useRouter();
  const [name, setName] = useState(start);
  const [alt, setAlt] = useState('');
  const [neu, setNeu] = useState('');
  const [neu2, setNeu2] = useState('');
  const [meldung, setMeldung] = useState<{ bereich: 'name' | 'passwort'; text: string; fehler: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function senden(bereich: 'name' | 'passwort', body: Record<string, string>, danach?: () => void) {
    setBusy(true);
    setMeldung(null);
    try {
      const res = await fetch('/api/konto', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMeldung({ bereich, text: data.error ?? `Fehler ${res.status}`, fehler: true });
      else {
        setMeldung({ bereich, text: bereich === 'name' ? 'Name gespeichert.' : 'Passwort geändert. Andere Sitzungen wurden abgemeldet.', fehler: false });
        danach?.();
        router.refresh();
      }
    } catch {
      setMeldung({ bereich, text: 'Server nicht erreichbar', fehler: true });
    } finally {
      setBusy(false);
    }
  }

  function passwortAendern(e: React.FormEvent) {
    e.preventDefault();
    if (neu.length < 12) return setMeldung({ bereich: 'passwort', text: 'Das neue Passwort muss mindestens 12 Zeichen lang sein.', fehler: true });
    if (neu !== neu2) return setMeldung({ bereich: 'passwort', text: 'Die beiden neuen Passwörter stimmen nicht überein.', fehler: true });
    void senden('passwort', { altesPasswort: alt, neuesPasswort: neu }, () => {
      setAlt('');
      setNeu('');
      setNeu2('');
    });
  }

  const zeige = (b: 'name' | 'passwort') =>
    meldung?.bereich === b && (
      <p role={meldung.fehler ? 'alert' : 'status'} className={`text-sm ${meldung.fehler ? 'text-red-600' : 'text-green-700'}`}>
        {meldung.text}
      </p>
    );

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void senden('name', { name });
        }}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 className="text-base font-semibold">Name</h2>
        <label className="block text-sm font-medium text-slate-700">
          Anzeigename
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} className={feld} />
        </label>
        {zeige('name')}
        <button type="submit" disabled={busy} className={knopf}>
          Name speichern
        </button>
      </form>

      <form onSubmit={passwortAendern} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Passwort ändern</h2>
        <label className="block text-sm font-medium text-slate-700">
          Bisheriges Passwort
          <input type="password" value={alt} onChange={(e) => setAlt(e.target.value)} required autoComplete="current-password" className={feld} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Neues Passwort <span className="font-normal text-slate-400">(mindestens 12 Zeichen)</span>
          <input type="password" value={neu} onChange={(e) => setNeu(e.target.value)} required minLength={12} autoComplete="new-password" className={feld} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Neues Passwort wiederholen
          <input type="password" value={neu2} onChange={(e) => setNeu2(e.target.value)} required autoComplete="new-password" className={feld} />
        </label>
        {zeige('passwort')}
        <button type="submit" disabled={busy} className={knopf}>
          Passwort ändern
        </button>
      </form>
    </div>
  );
}
