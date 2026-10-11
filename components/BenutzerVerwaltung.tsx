'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from './CopyButton';

type Rolle = 'admin' | 'mitglied' | 'lesen';
type BenutzerZeile = { id: number; email: string; name: string; rolle: Rolle; aktiv: boolean; letzterLoginAt: string | null; createdAt: string };
type EinladungZeile = { id: number; email: string; rolle: Rolle; ablaufAt: string; abgelaufen: boolean; createdAt: string };

const ROLLEN: { wert: Rolle; label: string }[] = [
  { wert: 'admin', label: 'Admin' },
  { wert: 'mitglied', label: 'Mitglied' },
  { wert: 'lesen', label: 'Nur lesen' },
];
const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopf = 'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });

export function BenutzerVerwaltung({ benutzer, einladungen, meineId }: { benutzer: BenutzerZeile[]; einladungen: EinladungZeile[]; meineId: number }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [rolle, setRolle] = useState<Rolle>('mitglied');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ fuer: string; url: string } | null>(null);

  async function aufruf(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setBusy(true);
    setFehler('');
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setFehler(typeof data.error === 'string' ? data.error : `Fehler ${res.status}`);
      else router.refresh();
      return { ok: res.ok, data };
    } catch {
      setFehler('Server nicht erreichbar');
      return { ok: false, data: {} };
    } finally {
      setBusy(false);
    }
  }

  async function einladen(e: React.FormEvent) {
    e.preventDefault();
    const r = await aufruf('/api/benutzer/einladungen', 'POST', { email, rolle });
    if (r.ok) {
      setLink({ fuer: String(r.data.email), url: String(r.data.link) });
      setEmail('');
    }
  }

  async function zuruecksetzen(b: BenutzerZeile) {
    if (!confirm(`Passwort von ${b.name} zurücksetzen? Sie erhalten einen neuen Einladungslink; das bisherige Passwort bleibt bis dahin gültig.`)) return;
    const r = await aufruf(`/api/benutzer/${b.id}/passwort-zuruecksetzen`, 'POST');
    if (r.ok) setLink({ fuer: b.email, url: String(r.data.link) });
  }

  async function aendern(b: BenutzerZeile, daten: { rolle?: Rolle; aktiv?: boolean }) {
    if (daten.aktiv === false && !confirm(`${b.name} deaktivieren? Offene Sitzungen werden sofort beendet.`)) return;
    await aufruf(`/api/benutzer/${b.id}`, 'PATCH', daten);
  }

  async function loeschen(b: BenutzerZeile) {
    if (!confirm(`${b.name} (${b.email}) endgültig löschen? Offene Sitzungen werden sofort beendet.`)) return;
    await aufruf(`/api/benutzer/${b.id}`, 'DELETE');
  }

  async function widerrufen(x: EinladungZeile) {
    if (!confirm(`Einladung für ${x.email} widerrufen?`)) return;
    await aufruf(`/api/benutzer/einladungen/${x.id}`, 'DELETE');
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-base font-semibold">Person einladen</h2>
        <p className="mb-3 text-xs text-slate-500">Es wird keine E-Mail verschickt: Sie erhalten einen Einmal-Link (7 Tage gültig), den Sie selbst weitergeben.</p>
        <form onSubmit={einladen} className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 basis-56 text-sm font-medium text-slate-700">
            E-Mail
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="name@firma.de" className={feld} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Rolle
            <select value={rolle} onChange={(e) => setRolle(e.target.value as Rolle)} className={feld}>
              {ROLLEN.map((r) => (
                <option key={r.wert} value={r.wert}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            Einladungslink erstellen
          </button>
        </form>
        {fehler && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {fehler}
          </p>
        )}
        {link && (
          <div data-testid="einladungslink" className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <p className="mb-1 font-medium">Link für {link.fuer} (wird nur jetzt angezeigt):</p>
            <p className="break-all font-mono text-xs">{link.url}</p>
            <div className="mt-2 flex items-center gap-3">
              <CopyButton text={link.url} label="Link kopieren" />
              <button type="button" onClick={() => setLink(null)} className="text-xs text-slate-600 hover:underline">
                Ausblenden
              </button>
            </div>
          </div>
        )}
      </section>

      {einladungen.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-base font-semibold">Offene Einladungen</h2>
          <ul className="divide-y divide-slate-100">
            {einladungen.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0 break-all font-medium">{x.email}</span>
                <span className="text-xs text-slate-500">{ROLLEN.find((r) => r.wert === x.rolle)?.label}</span>
                <span className={`text-xs ${x.abgelaufen ? 'text-red-600' : 'text-slate-500'}`}>{x.abgelaufen ? 'abgelaufen' : `gültig bis ${zeit.format(new Date(x.ablaufAt))}`}</span>
                <button onClick={() => widerrufen(x)} disabled={busy} className={`${knopf} ml-auto`}>
                  Widerrufen
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold">Benutzer</h2>
        {benutzer.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine Benutzer. Der Zugang über ADMIN_PASSWORD funktioniert weiterhin.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="benutzerliste">
            {benutzer.map((b) => (
              <li key={b.id} className="py-3 text-sm" data-testid={`benutzer-${b.email}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{b.name}</span>
                  {b.id === meineId && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">Sie</span>}
                  {!b.aktiv && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">deaktiviert</span>}
                  <span className="break-all text-xs text-slate-500">{b.email}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">letzter Login: {b.letzterLoginAt ? zeit.format(new Date(b.letzterLoginAt)) : 'noch nie'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={b.rolle}
                    onChange={(e) => aendern(b, { rolle: e.target.value as Rolle })}
                    disabled={busy}
                    aria-label={`Rolle von ${b.name}`}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                  >
                    {ROLLEN.map((r) => (
                      <option key={r.wert} value={r.wert}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {b.id !== meineId && (
                    <button onClick={() => aendern(b, { aktiv: !b.aktiv })} disabled={busy} className={knopf}>
                      {b.aktiv ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                  )}
                  {b.aktiv && (
                    <button onClick={() => zuruecksetzen(b)} disabled={busy} className={knopf}>
                      Passwort zurücksetzen
                    </button>
                  )}
                  {b.id !== meineId && (
                    <button onClick={() => loeschen(b)} disabled={busy} className={`${knopf} border-red-200 text-red-700 hover:bg-red-50`}>
                      Löschen
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
