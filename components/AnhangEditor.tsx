'use client';

import { useRef, useState } from 'react';
import { ACCEPT, ERLAUBTE_ENDUNGEN_TEXT, formatGroesse, MAX_ANZAHL, MAX_DATEI_BYTES, MAX_GESAMT_BYTES, ZUSTELLBARKEIT_HINWEIS } from '@/lib/anhaenge';

export type AnhangInfo = { id: number; dateiname: string; groesse: number };

/** „📎 Name (Größe)“-Liste unter dem Betreff der Mail-Vorschau */
export function AnhangVorschau({ anhaenge }: { anhaenge: AnhangInfo[] }) {
  if (anhaenge.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-200 px-3 py-2 text-sm" aria-label="Anhänge der Mail">
      {anhaenge.map((a) => (
        <li key={a.id} className="min-w-0 max-w-full truncate text-slate-700" title={a.dateiname}>
          <span aria-hidden>📎</span> {a.dateiname} <span className="text-slate-500">({formatGroesse(a.groesse)})</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Anhänge eines Mail-Schritts (Erstmail: followupId null; Follow-up: dessen ID). Upload per Drag-and-drop oder Dateiauswahl,
 * Liste mit Download und Entfernen. Ohne `followupId` (Follow-up noch nicht gespeichert) ist kein Upload möglich.
 * Die Grenzen prüft der Server; hier werden sie nur angezeigt und offensichtliche Verstöße vorab gemeldet.
 */
export function AnhangEditor({
  campaignId,
  followupId,
  anhaenge,
  onChange,
  erstmail = false,
  gesperrt = false,
}: {
  campaignId: number;
  /** null = Erstmail, undefined = Follow-up noch nicht gespeichert */
  followupId: number | null | undefined;
  anhaenge: AnhangInfo[];
  onChange: (liste: AnhangInfo[]) => void;
  /** Zustellbarkeits-Hinweis anzeigen (Erstkontakt-Mail) */
  erstmail?: boolean;
  gesperrt?: boolean;
}) {
  const [fehler, setFehler] = useState<string[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [drag, setDrag] = useState(false);
  const eingabe = useRef<HTMLInputElement>(null);
  // Während mehrerer Uploads hinter einander die aktuelle Liste mitführen
  const liste = useRef(anhaenge);
  liste.current = anhaenge;

  const speicherbar = followupId !== undefined && !gesperrt;
  const summe = anhaenge.reduce((s, a) => s + a.groesse, 0);
  const basis = `/api/campaigns/${campaignId}/anhaenge`;

  async function hochladen(dateien: File[]) {
    if (!speicherbar || dateien.length === 0) return;
    setLaedt(true);
    const meldungen: string[] = [];
    for (const datei of dateien) {
      if (datei.size > MAX_DATEI_BYTES) {
        meldungen.push(`„${datei.name}“ ist zu groß (${formatGroesse(datei.size)}, erlaubt sind ${formatGroesse(MAX_DATEI_BYTES)} je Datei)`);
        continue;
      }
      const form = new FormData();
      form.set('datei', datei);
      form.set('followupId', followupId === null ? '' : String(followupId));
      try {
        const res = await fetch(basis, { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.anhang) {
          liste.current = [...liste.current, { id: data.anhang.id, dateiname: data.anhang.dateiname, groesse: data.anhang.groesse }];
          onChange(liste.current);
        } else meldungen.push(data.error ?? `„${datei.name}“: Upload fehlgeschlagen`);
      } catch {
        meldungen.push(`„${datei.name}“: Upload fehlgeschlagen (keine Verbindung)`);
      }
    }
    setFehler(meldungen);
    setLaedt(false);
    if (eingabe.current) eingabe.current.value = '';
  }

  async function entfernen(a: AnhangInfo) {
    if (!confirm(`Anhang „${a.dateiname}“ entfernen?`)) return;
    const res = await fetch(`${basis}/${a.id}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      liste.current = liste.current.filter((x) => x.id !== a.id);
      onChange(liste.current);
      setFehler([]);
    } else {
      const data = await res.json().catch(() => ({}));
      setFehler([data.error ?? 'Entfernen fehlgeschlagen']);
    }
  }

  return (
    <section className="mt-4 rounded-md border border-slate-200 bg-slate-50/60 p-3" aria-label="Anhänge" onClick={(e) => e.stopPropagation()}>
      <h4 className="text-sm font-semibold text-slate-800">Anhänge</h4>
      {erstmail && (
        <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" role="note">
          {ZUSTELLBARKEIT_HINWEIS}
        </p>
      )}

      {anhaenge.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {anhaenge.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 basis-40 break-words text-slate-800">
                <span aria-hidden>📎</span> {a.dateiname}
              </span>
              <span className="text-xs text-slate-500">{formatGroesse(a.groesse)}</span>
              <a href={`${basis}/${a.id}`} className="text-xs font-medium text-indigo-700 hover:underline" download>
                Download
              </a>
              <button type="button" onClick={() => void entfernen(a)} disabled={gesperrt} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-slate-50 disabled:opacity-40">
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}

      {followupId === undefined ? (
        <p className="mt-2 text-xs text-slate-600">Anhänge können hinzugefügt werden, sobald das Follow-up gespeichert ist.</p>
      ) : (
        <div
          onDragOver={(e) => {
            if (!speicherbar) return;
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void hochladen([...e.dataTransfer.files]);
          }}
          className={`mt-2 flex flex-col items-start gap-2 rounded-md border border-dashed px-3 py-3 text-sm sm:flex-row sm:items-center ${drag ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300 bg-white'}`}
        >
          <input ref={eingabe} type="file" multiple accept={ACCEPT} className="sr-only" id={`anhang-${campaignId}-${followupId ?? 'erst'}`} disabled={!speicherbar || laedt || anhaenge.length >= MAX_ANZAHL} onChange={(e) => void hochladen([...(e.target.files ?? [])])} />
          <label
            htmlFor={`anhang-${campaignId}-${followupId ?? 'erst'}`}
            className={`rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ${speicherbar && !laedt && anhaenge.length < MAX_ANZAHL ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-50'}`}
          >
            {laedt ? 'Lädt hoch …' : 'Datei auswählen'}
          </label>
          <span className="text-slate-600">oder hierher ziehen</span>
        </div>
      )}

      {fehler.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-600" role="alert">
          {fehler.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs text-slate-500">
        Erlaubt: {ERLAUBTE_ENDUNGEN_TEXT}. Höchstens {MAX_ANZAHL} Dateien je Mail, {formatGroesse(MAX_DATEI_BYTES)} je Datei, {formatGroesse(MAX_GESAMT_BYTES)} insgesamt
        {anhaenge.length > 0 ? ` (aktuell ${anhaenge.length} von ${MAX_ANZAHL}, ${formatGroesse(summe)})` : ''}. Gilt für alle Varianten dieser Mail.
      </p>
    </section>
  );
}
