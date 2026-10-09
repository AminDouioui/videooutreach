'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FELD_LABELS, IMPORT_FELDER, ROW_STATUS, STATUS_LABELS, type ImportFeld, type Mapping, type Row, type RowStatus, type ValidatedRow } from '@/lib/import';
import { FilterChips, passt, SortKopf, Suche, useSortierung } from './Tabelle';

type ErgebnisSpalte = 'index' | 'status' | 'firma' | 'name' | 'email';

type Parsed = { headers: string[]; rows: Row[]; guessedMapping: Mapping };
type Validierung = { rows: ValidatedRow[]; counts: Record<RowStatus, number>; summary: string };

const STATUS_FARBE: Record<RowStatus, string> = {
  ok: 'bg-green-100 text-green-800',
  ungueltige_email: 'bg-red-100 text-red-800',
  duplikat_datei: 'bg-amber-100 text-amber-800',
  duplikat_bestand: 'bg-amber-100 text-amber-800',
  duplikat_firma: 'bg-amber-100 text-amber-800',
  gesperrt: 'bg-red-100 text-red-800',
  fehlende_pflichtfelder: 'bg-red-100 text-red-800',
};

async function fehlerText(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return data.error ?? `Fehler (${res.status})`;
}

export function ImportWizard({ campaignId }: { campaignId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [dateiname, setDateiname] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [validierung, setValidierung] = useState<Validierung | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const [einProFirma, setEinProFirma] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RowStatus | 'alle'>('alle');
  const [suche, setSuche] = useState('');

  const gefiltert = (validierung?.rows ?? []).filter(
    (r) => (statusFilter === 'alle' || r.status === statusFilter) && passt(suche, r.lead.firma, r.lead.email, r.lead.vorname, r.lead.nachname),
  );
  const { sortiert, key: sortKey, asc: sortAsc, sortieren } = useSortierung<ValidatedRow, ErgebnisSpalte>(
    gefiltert,
    (r, k) =>
      k === 'index' ? r.index : k === 'status' ? STATUS_LABELS[r.status] : k === 'name' ? [r.lead.vorname, r.lead.nachname].filter(Boolean).join(' ') : r.lead[k],
    { key: 'index', asc: true },
  );

  async function hochladen(datei: File) {
    setFehler('');
    setValidierung(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', datei);
      const res = await fetch('/api/upload/parse', { method: 'POST', body: fd });
      if (!res.ok) {
        setFehler(await fehlerText(res));
        return;
      }
      const data: Parsed = await res.json();
      setParsed(data);
      setMapping(data.guessedMapping);
      setDateiname(datei.name);
    } catch {
      setFehler('Upload fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  function zuruecksetzen() {
    setParsed(null);
    setMapping(null);
    setValidierung(null);
    setFehler('');
    if (inputRef.current) inputRef.current.value = '';
  }

  async function pruefen(proFirma = einProFirma) {
    if (!parsed || !mapping) return;
    setFehler('');
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/import/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping, rows: parsed.rows, einProFirma: proFirma }),
      });
      if (!res.ok) setFehler(await fehlerText(res));
      else setValidierung(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function importieren() {
    if (!parsed || !mapping) return;
    setFehler('');
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping, rows: parsed.rows, einProFirma }),
      });
      if (!res.ok) {
        setFehler(await fehlerText(res));
        setBusy(false);
        return;
      }
      router.push(`/kampagnen/${campaignId}`);
      router.refresh();
    } catch {
      setFehler('Import fehlgeschlagen');
      setBusy(false);
    }
  }

  function setFeld(feld: ImportFeld, spalte: string) {
    setValidierung(null);
    setMapping((m) => (m ? { ...m, [feld]: spalte || null } : m));
  }

  // Schritt 1: Upload
  if (!parsed || !mapping) {
    return (
      <div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void hochladen(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center ${drag ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
        >
          <p className="font-medium">{busy ? 'Datei wird gelesen …' : 'Datei hierher ziehen oder klicken'}</p>
          <p className="mt-1 text-sm text-slate-500">.xlsx oder .csv, maximal 5 MB, bis zu 5000 Zeilen</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void hochladen(f);
            }}
          />
        </div>
        {fehler && <p className="mt-3 text-sm text-red-600">{fehler}</p>}
      </div>
    );
  }

  // Schritt 2/3: Mapping, Vorschau, Validierung
  const vorschau = parsed.rows.slice(0, 5);
  const gueltig = validierung?.counts.ok ?? 0;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <span>
          <strong>{dateiname}</strong> · {parsed.rows.length} Zeilen, {parsed.headers.length} Spalten
        </span>
        <button onClick={zuruecksetzen} className="text-indigo-600 hover:underline">
          Andere Datei wählen
        </button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">Spalten zuordnen</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {IMPORT_FELDER.map((feld) => (
            <label key={feld} className="block text-sm font-medium text-slate-700">
              {FELD_LABELS[feld]}
              {(feld === 'firma' || feld === 'email') && <span className="text-red-600"> *</span>}
              <select
                value={mapping[feld] ?? ''}
                onChange={(e) => setFeld(feld, e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">– nicht zuordnen –</option>
                {parsed.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Nicht zugeordnete Spalten werden als Zusatzdaten gespeichert. Ist nur „Name“ zugeordnet, wird er in Vor- und Nachname geteilt.</p>

        <h3 className="mb-2 mt-5 text-sm font-semibold">Vorschau (erste {vorschau.length} Zeilen)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                {parsed.headers.map((h) => (
                  <th key={h} className="px-2 py-1">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vorschau.map((r, i) => (
                <tr key={i}>
                  {parsed.headers.map((h) => (
                    <td key={h} className="px-2 py-1">
                      {r[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={einProFirma}
            onChange={(e) => {
              setEinProFirma(e.target.checked);
              // Bereits geprüft: mit der neuen Einstellung direkt neu prüfen
              if (validierung) void pruefen(e.target.checked);
            }}
            className="mt-0.5"
          />
          <span>
            <strong>Nur einen Kontakt pro Firma</strong> – weitere Kontakte derselben Firma (auch „Müller GmbH“ vs. „Müller GmbH &amp; Co. KG“) und Firmen, die schon in
            dieser Kampagne sind, werden nicht importiert.
          </span>
        </label>

        <div className="mt-4">
          <button
            onClick={() => pruefen()}
            disabled={busy || !mapping.firma || !mapping.email}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy && !validierung ? 'Prüfen …' : 'Prüfen'}
          </button>
          {(!mapping.firma || !mapping.email) && <span className="ml-3 text-sm text-amber-700">Bitte Firma und E-Mail zuordnen.</span>}
        </div>
      </section>

      {fehler && <p className="text-sm text-red-600">{fehler}</p>}

      {validierung && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-semibold">Ergebnis der Prüfung</h2>
          <p className="mb-3 text-sm text-slate-700">{validierung.summary}</p>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Suche wert={suche} onChange={setSuche} platzhalter="Suche nach Firma, Name oder E-Mail" />
            <FilterChips
              optionen={[
                { key: 'alle' as const, label: 'Alle', anzahl: validierung.rows.length },
                ...ROW_STATUS.filter((st) => validierung.counts[st] > 0).map((st) => ({ key: st, label: STATUS_LABELS[st], anzahl: validierung.counts[st] })),
              ]}
              aktiv={statusFilter}
              onChange={setStatusFilter}
            />
            <span className="text-xs text-slate-500">
              {sortiert.length} von {validierung.rows.length} Zeilen
            </span>
          </div>
          <div className="max-h-96 overflow-auto rounded border border-slate-100">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  {(
                    [
                      ['index', '#'],
                      ['status', 'Status'],
                      ['firma', 'Firma'],
                      ['name', 'Ansprechpartner'],
                      ['email', 'E-Mail'],
                    ] as [ErgebnisSpalte, string][]
                  ).map(([k, label]) => (
                    <SortKopf key={k} label={label} aktiv={sortKey === k} asc={sortAsc} onClick={() => sortieren(k, k !== 'index')} />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortiert.map((r) => (
                  <tr key={r.index}>
                    <td className="px-2 py-1 text-slate-400">{r.index + 1}</td>
                    <td className="px-2 py-1">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_FARBE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </td>
                    <td className="px-2 py-1">{r.lead.firma}</td>
                    <td className="px-2 py-1">{[r.lead.vorname, r.lead.nachname].filter(Boolean).join(' ')}</td>
                    <td className="px-2 py-1">{r.lead.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <button
              onClick={importieren}
              disabled={busy || gueltig === 0}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? 'Importiere …' : `${gueltig} gültige Leads importieren`}
            </button>
            {gueltig === 0 && <span className="ml-3 text-sm text-amber-700">Keine gültigen Zeilen zum Importieren.</span>}
          </div>
        </section>
      )}
    </div>
  );
}
