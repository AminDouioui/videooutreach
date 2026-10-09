'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { passt, SortKopf, Suche, useSortierung } from './Tabelle';

type Eintrag = { email: string; reason: string | null; createdAt: string };
type Spalte = 'email' | 'reason' | 'createdAt';

export function SuppressionList({ eintraege }: { eintraege: Eintrag[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [grund, setGrund] = useState('');
  const [fehler, setFehler] = useState('');
  const [suche, setSuche] = useState('');
  const { sortiert, key, asc, sortieren } = useSortierung<Eintrag, Spalte>(
    eintraege.filter((r) => passt(suche, r.email, r.reason)),
    (r, k) => r[k],
    { key: 'createdAt', asc: false },
  );

  async function hinzufuegen(e: React.FormEvent) {
    e.preventDefault();
    setFehler('');
    const res = await fetch('/api/suppression', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, reason: grund || undefined }) });
    if (res.ok) {
      setEmail('');
      setGrund('');
      router.refresh();
    } else setFehler((await res.json().catch(() => ({}))).error ?? 'Hinzufügen fehlgeschlagen');
  }

  async function entfernen(adresse: string) {
    if (!confirm(`${adresse} von der Sperrliste entfernen? Abgemeldete Leads bleiben trotzdem abgemeldet.`)) return;
    await fetch('/api/suppression', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: adresse }) });
    router.refresh();
  }

  const fmt = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short' });
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-base font-semibold">Sperrliste</h2>
      <p className="mb-3 text-xs text-slate-500">Diese Adressen erhalten nie E-Mails (kampagnenübergreifend) und werden beim Import abgelehnt. Abmeldungen landen automatisch hier.</p>
      <form onSubmit={hinzufuegen} className="mb-4 flex flex-wrap gap-2">
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" className="min-w-0 flex-1 basis-48 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="Grund (optional)" className="min-w-0 flex-1 basis-36 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Hinzufügen</button>
      </form>
      {fehler && <p className="mb-2 text-sm text-red-600">{fehler}</p>}
      {eintraege.length === 0 ? (
        <p className="text-sm text-slate-500">Die Sperrliste ist leer.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Suche wert={suche} onChange={setSuche} platzhalter="E-Mail oder Grund suchen" />
            <span className="text-xs text-slate-500">
              {sortiert.length} von {eintraege.length} Einträgen
            </span>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <SortKopf label="E-Mail" aktiv={key === 'email'} asc={asc} onClick={() => sortieren('email', true)} />
                <SortKopf label="Grund" aktiv={key === 'reason'} asc={asc} onClick={() => sortieren('reason', true)} />
                <SortKopf label="Seit" aktiv={key === 'createdAt'} asc={asc} onClick={() => sortieren('createdAt')} />
                <th />
              </tr>
            </thead>
            <tbody>
              {sortiert.map((r) => (
                <tr key={r.email} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 break-all">{r.email}</td>
                  <td className="py-1.5 pr-3 text-slate-600">{r.reason ?? ''}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">{fmt.format(new Date(r.createdAt))}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => entfernen(r.email)} className="text-xs font-medium text-red-600 hover:underline">Entfernen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
