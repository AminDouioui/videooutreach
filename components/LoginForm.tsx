'use client';

import { useState } from 'react';

export function LoginForm() {
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');
  const [laedt, setLaedt] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setLaedt(true);
    setFehler('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwort }),
      });
      if (res.ok) {
        // Nur interne Pfade als Ziel zulassen (kein Open Redirect)
        const next = new URLSearchParams(window.location.search).get('next') ?? '/';
        window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
        return;
      }
      const data = await res.json().catch(() => ({}));
      setFehler(data.error ?? 'Anmeldung fehlgeschlagen');
    } catch {
      setFehler('Server nicht erreichbar');
    }
    setLaedt(false);
  }

  return (
    <form onSubmit={absenden} className="space-y-4">
      <label className="block text-sm font-medium text-slate-700">
        Passwort
        <input
          type="password"
          autoFocus
          required
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        />
      </label>
      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      <button
        type="submit"
        disabled={laedt}
        className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {laedt ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  );
}
