'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Filter für einen neuen Pipeline-Lauf: Branche, Mitarbeiterklasse, Region/PLZ, Rechtsform, Zielrolle, Mindest-Score, nur verifizierte E-Mails.

const BRANCHEN = [
  ['werkzeugbau', 'Werkzeugbau'],
  ['formenbau', 'Formenbau'],
  ['maschinenbau', 'Maschinenbau'],
  ['sonstige_fertigung', 'Sonstige Fertigung'],
] as const;
const KLASSEN: Array<[string, number, number]> = [
  ['50 bis 99', 50, 99],
  ['100 bis 249', 100, 249],
  ['250 bis 499', 250, 499],
  ['500 bis 800', 500, 800],
  ['100 bis 800 (Zielgruppe)', 100, 800],
];
const BUNDESLAENDER = [
  'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen',
  'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
];
const RECHTSFORMEN = ['GmbH', 'GmbH & Co. KG', 'AG', 'KG', 'UG (haftungsbeschränkt)', 'e.K.'];

const feld = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

function Mehrfach({ titel, optionen, gewaehlt, onChange }: { titel: string; optionen: ReadonlyArray<readonly [string, string]>; gewaehlt: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-700">{titel}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {optionen.map(([wert, label]) => (
          <label key={wert} className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={gewaehlt.includes(wert)} onChange={(e) => onChange(e.target.checked ? [...gewaehlt, wert] : gewaehlt.filter((x) => x !== wert))} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function LeadgenFilter({ rollen }: { rollen: Array<{ key: string; label: string }> }) {
  const router = useRouter();
  const [branchen, setBranchen] = useState<string[]>(['werkzeugbau', 'formenbau']);
  const [min, setMin] = useState(100);
  const [max, setMax] = useState(800);
  const [laender, setLaender] = useState<string[]>([]);
  const [plz, setPlz] = useState('');
  const [formen, setFormen] = useState<string[]>([]);
  const [rolle, setRolle] = useState(rollen[0]?.key ?? 'einkauf_leitung');
  const [mindestScore, setMindestScore] = useState(0);
  const [nurVerifiziert, setNurVerifiziert] = useState(true);
  const [maxFirmen, setMaxFirmen] = useState(100);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler('');
    const praefixe = plz.split(/[\s,;]+/).filter(Boolean);
    if (praefixe.some((p) => !/^\d{1,5}$/.test(p))) {
      setFehler('PLZ-Bereiche bitte als Ziffern angeben, z. B. 70, 71, 72.');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/leadgen/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: { branchen, mitarbeiterMin: min, mitarbeiterMax: max, bundeslaender: laender, plzPraefixe: praefixe, rechtsformen: formen, zielRolle: rolle, mindestScore, nurVerifizierteEmail: nurVerifiziert, maxFirmen } }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!res.ok || !data.id) {
        setFehler(data.error ?? 'Der Lauf konnte nicht gestartet werden.');
        return;
      }
      router.push(`/leads-generieren/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={start} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5" data-testid="leadgen-filter">
      <h2 className="text-base font-semibold">Neue Lead-Generierung</h2>
      <Mehrfach titel="Branche" optionen={BRANCHEN} gewaehlt={branchen} onChange={setBranchen} />
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">Mitarbeiterklasse</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            aria-label="Mitarbeiterklasse"
            className={feld}
            value={KLASSEN.find((k) => k[1] === min && k[2] === max)?.[0] ?? 'eigen'}
            onChange={(e) => {
              const k = KLASSEN.find((x) => x[0] === e.target.value);
              if (k) {
                setMin(k[1]);
                setMax(k[2]);
              }
            }}
          >
            {KLASSEN.map((k) => (
              <option key={k[0]}>{k[0]}</option>
            ))}
            <option value="eigen">Eigener Bereich</option>
          </select>
          <span className="text-slate-500">oder von</span>
          <input type="number" min={0} value={min} onChange={(e) => setMin(Number(e.target.value))} className={`${feld} w-24`} aria-label="Mitarbeiter von" />
          <span className="text-slate-500">bis</span>
          <input type="number" min={1} value={max} onChange={(e) => setMax(Number(e.target.value))} className={`${feld} w-24`} aria-label="Mitarbeiter bis" />
        </div>
        <p className="mt-1 text-xs text-slate-500">Bei Firmen ohne bekannte Mitarbeiterzahl wird die Zahl nicht ausgeschlossen, sie bekommen aber einen niedrigeren Score.</p>
      </div>
      <Mehrfach titel="Region (Bundesland)" optionen={BUNDESLAENDER.map((b) => [b, b] as const)} gewaehlt={laender} onChange={setLaender} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">oder PLZ-Bereiche</span>
        <input value={plz} onChange={(e) => setPlz(e.target.value)} placeholder="z. B. 70, 71, 72" className={`${feld} w-64`} />
      </label>
      <Mehrfach titel="Rechtsform" optionen={RECHTSFORMEN.map((r) => [r, r] as const)} gewaehlt={formen} onChange={setFormen} />
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Zielrolle</span>
          <select value={rolle} onChange={(e) => setRolle(e.target.value)} className={feld}>
            {rollen.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Mindest-Score</span>
          <input type="number" min={0} max={100} value={mindestScore} onChange={(e) => setMindestScore(Number(e.target.value))} className={`${feld} w-20`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Höchstens Firmen</span>
          <input type="number" min={1} max={2000} value={maxFirmen} onChange={(e) => setMaxFirmen(Number(e.target.value))} className={`${feld} w-24`} />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={nurVerifiziert} onChange={(e) => setNurVerifiziert(e.target.checked)} />
          Nur verifizierte E-Mails anzeigen
        </label>
      </div>
      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      <button type="submit" disabled={busy || branchen.length === 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? 'Starte …' : 'Leads generieren'}
      </button>
      {branchen.length === 0 && <span className="ml-3 text-xs text-slate-500">Bitte mindestens eine Branche wählen.</span>}
    </form>
  );
}
