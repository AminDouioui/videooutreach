'use client';

import { useState } from 'react';

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

export function EinladungAnnehmen({ token, zuruecksetzen }: { token: string; zuruecksetzen: boolean }) {
  const [name, setName] = useState('');
  const [passwort, setPasswort] = useState('');
  const [wiederholung, setWiederholung] = useState('');
  const [fehler, setFehler] = useState('');
  const [laedt, setLaedt] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setFehler('');
    if (passwort.length < 12) return setFehler('Das Passwort muss mindestens 12 Zeichen lang sein.');
    if (passwort !== wiederholung) return setFehler('Die beiden Passwörter stimmen nicht überein.');
    setLaedt(true);
    try {
      const res = await fetch(`/api/einladung/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, passwort }) });
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setFehler(data.error ?? 'Die Einladung konnte nicht angenommen werden.');
    } catch {
      setFehler('Server nicht erreichbar');
    }
    setLaedt(false);
  }

  return (
    <form onSubmit={absenden} className="space-y-4">
      {!zuruecksetzen && (
        <label className="block text-sm font-medium text-slate-700">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" autoFocus className={feld} />
        </label>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Passwort <span className="font-normal text-slate-400">(mindestens 12 Zeichen)</span>
        <input type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} required minLength={12} autoComplete="new-password" className={feld} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Passwort wiederholen
        <input type="password" value={wiederholung} onChange={(e) => setWiederholung(e.target.value)} required autoComplete="new-password" className={feld} />
      </label>
      {fehler && (
        <p role="alert" className="text-sm text-red-600">
          {fehler}
        </p>
      )}
      <button type="submit" disabled={laedt} className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {laedt ? 'Wird gespeichert …' : zuruecksetzen ? 'Passwort speichern und anmelden' : 'Konto anlegen und anmelden'}
      </button>
    </form>
  );
}
