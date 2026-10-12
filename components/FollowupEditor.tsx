'use client';

import { useEffect, useState } from 'react';
import { MAX_VARIANTEN, naechstesKuerzel, STANDARD_VARIANTE } from '@/lib/varianten';
import { pruefeFelder } from '@/lib/schreibregeln';
import { pruefeVorlage, STANDARD_VARIABLEN } from '@/lib/vorlage';
import { AnhangEditor, AnhangVorschau, type AnhangInfo } from './AnhangEditor';
import { KiVorschlag } from './KiKomponenten';
import { platzhalterFuer } from './TemplateEditor';
import { VorlagenHinweise } from './VorlagenHilfe';

type LeadOption = { id: number; label: string };
type FVariante = { kuerzel: string; text: string; betreff: string; aktiv: boolean };
/** Variante A = body/betreff; varianten = B–E. Betreff gesetzt = neuer Thread statt „Re: …“. */
type Schritt = { /** Datensatz-ID, sobald gespeichert (Anhänge hängen daran) */ id?: number; waitDays: number; body: string; betreff: string; varianten: FVariante[] };
type Preview = { subject: string; html: string; text: string };

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const klein = 'rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40';

const NEUER_SCHRITT: Schritt = {
  waitDays: 3,
  betreff: '',
  varianten: [],
  body: '{{begruessung}},\n\nich wollte kurz nachhaken, ob meine letzte Nachricht bei Ihnen angekommen ist.\n\nPasst ein kurzes Gespräch in den nächsten Tagen?',
};

/**
 * Follow-ups des E-Mail-Flows: Wartezeit in Tagen + Text je Schritt, optional mit A/B-Varianten (bis zu 5) und eigenem
 * Betreff. Ohne eigenen Betreff wird als Antwort im Thread der Erstmail gesendet („Re: …“), mit eigenem Betreff als
 * neuer Thread; antwortet der Lead, endet sein Flow automatisch.
 */
export function FollowupEditor({
  campaignId,
  initial,
  leads,
  varianten = [],
  mitVideo,
  extraSpalten = [],
  kiAktiv = false,
  schreibregeln = false,
  anhaenge: anhaenge0 = {},
  gesperrt = false,
}: {
  campaignId: number;
  initial: Schritt[];
  leads: LeadOption[];
  /** Kürzel aller Varianten der Erstmail (A, B …); bei mehr als einer wählbar für die Vorschau „Re: …“ */
  varianten?: string[];
  mitVideo: boolean;
  extraSpalten?: string[];
  kiAktiv?: boolean;
  /** Prozessia-Schreibregeln prüfen (Einstellung) */
  schreibregeln?: boolean;
  /** Bereits hochgeladene Anhänge je Follow-up-ID */
  anhaenge?: Record<number, AnhangInfo[]>;
  /** Rolle ohne Schreibrecht (Upload gesperrt) */
  gesperrt?: boolean;
}) {
  const [anhaenge, setAnhaenge] = useState<Record<number, AnhangInfo[]>>(anhaenge0);
  const [schritte, setSchritte] = useState<Schritt[]>(initial);
  const [gespeichert, setGespeichert] = useState(JSON.stringify(initial));
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  // Gewählter Schritt und darin gewählte Variante (Bearbeiten + Vorschau)
  const [wahl, setWahl] = useState<{ schritt: number; kuerzel: string }>({ schritt: 0, kuerzel: STANDARD_VARIANTE });
  const aktiv = wahl.schritt;
  const setAktiv = (i: number) => setWahl((w) => (w.schritt === i ? w : { schritt: i, kuerzel: STANDARD_VARIANTE }));
  const [leadId, setLeadId] = useState<number | null>(leads[0]?.id ?? null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // leer = Variante des Leads (bzw. die, die er bekäme)
  const [variante, setVariante] = useState('');
  const bekannt = [...STANDARD_VARIABLEN, ...extraSpalten];
  // Alle Texte und Betreffe (inkl. Varianten) prüfen wie die Erstmail
  const pruefungen = schritte.flatMap((x, i) =>
    [
      { name: '', text: x.body },
      { name: 'Betreff: ', text: x.betreff },
      ...x.varianten.flatMap((v) => [
        { name: `Variante ${v.kuerzel}: `, text: v.text },
        { name: `Variante ${v.kuerzel} Betreff: `, text: v.betreff },
      ]),
    ].map((t) => ({ i, name: t.name, p: pruefeVorlage(t.text, bekannt) })),
  );
  const klammerFehler = pruefungen.flatMap(({ i, name, p }) => p.fehler.map((f) => `Follow-up ${i + 1}: ${name}${f}`));
  const unbekannt = [...new Set(pruefungen.flatMap(({ p }) => p.unbekannt))];
  const regelVerstoesse = schreibregeln
    ? schritte.flatMap((x, i) =>
        pruefeFelder([
          { ort: `Follow-up ${i + 1} Text`, text: x.body },
          { ort: `Follow-up ${i + 1} Betreff`, text: x.betreff },
          ...x.varianten.flatMap((v) => [
            { ort: `Follow-up ${i + 1} Variante ${v.kuerzel} Text`, text: v.text },
            { ort: `Follow-up ${i + 1} Variante ${v.kuerzel} Betreff`, text: v.betreff },
          ]),
        ]),
      )
    : [];
  const geaendert = JSON.stringify(schritte) !== gespeichert;
  const schritt = schritte[aktiv];
  // Gewählte Variante des aktiven Schritts (Rückfall A, falls gelöscht)
  const aktivVar = schritt?.varianten.find((v) => v.kuerzel === wahl.kuerzel);
  const vorschauText = aktivVar ? aktivVar.text : schritt?.body ?? '';
  const vorschauBetreff = aktivVar ? aktivVar.betreff : schritt?.betreff ?? '';

  // Live-Vorschau des gewählten Follow-ups
  useEffect(() => {
    if (leadId === null || !schritt) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/mail-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variante: variante || undefined, followupBody: vorschauText, followupBetreff: vorschauBetreff, followupNr: aktiv + 1, followupId: schritt.id }),
          signal: ctrl.signal,
        });
        if (res.ok) setPreview(await res.json());
      } catch {
        // abgebrochen oder offline – nächste Änderung lädt neu
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [leadId, schritt, vorschauText, vorschauBetreff, variante, aktiv]);

  function aendern(i: number, patch: Partial<Schritt>) {
    setSchritte((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function hinzufuegen() {
    setSchritte((s) => [...s, { ...NEUER_SCHRITT }]);
    setWahl({ schritt: schritte.length, kuerzel: STANDARD_VARIANTE });
  }
  /** Variante bearbeiten: A = Schritt selbst, sonst die Zusatzvariante */
  function varianteAendern(i: number, kuerzel: string, patch: { text?: string; betreff?: string; aktiv?: boolean }) {
    setSchritte((s) =>
      s.map((x, j) => {
        if (j !== i) return x;
        if (kuerzel === STANDARD_VARIANTE) return { ...x, ...(patch.text !== undefined ? { body: patch.text } : {}), ...(patch.betreff !== undefined ? { betreff: patch.betreff } : {}) };
        return { ...x, varianten: x.varianten.map((v) => (v.kuerzel === kuerzel ? { ...v, ...patch } : v)) };
      }),
    );
  }
  function varianteHinzufuegen(i: number) {
    const k = naechstesKuerzel(schritte[i].varianten.map((v) => v.kuerzel));
    if (!k) return;
    // Neue Variante startet als Kopie von A (Text und Betreff)
    setSchritte((s) => s.map((x, j) => (j === i ? { ...x, varianten: [...x.varianten, { kuerzel: k, text: x.body, betreff: x.betreff, aktiv: true }] } : x)));
    setWahl({ schritt: i, kuerzel: k });
  }
  function varianteLoeschen(i: number, kuerzel: string) {
    if (!confirm(`Variante ${kuerzel} von Follow-up ${i + 1} löschen?`)) return;
    setSchritte((s) => s.map((x, j) => (j === i ? { ...x, varianten: x.varianten.filter((v) => v.kuerzel !== kuerzel) } : x)));
    setWahl({ schritt: i, kuerzel: STANDARD_VARIANTE });
  }
  function entfernen(i: number) {
    if (!confirm(`Follow-up ${i + 1} entfernen?`)) return;
    setSchritte((s) => s.filter((_, j) => j !== i));
    setWahl({ schritt: Math.max(0, aktiv >= i ? aktiv - 1 : aktiv), kuerzel: STANDARD_VARIANTE });
  }
  function verschieben(i: number, d: -1 | 1) {
    setSchritte((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
    setWahl({ schritt: i + d, kuerzel: wahl.schritt === i ? wahl.kuerzel : STANDARD_VARIANTE });
  }

  async function speichern() {
    setStatus(null);
    const res = await fetch(`/api/campaigns/${campaignId}/followups`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followups: schritte }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      // Neue Schritte haben jetzt eine ID (Anhänge sind ab da möglich); bestehende behalten ihre
      const ids: number[] = Array.isArray(data.ids) ? data.ids : [];
      const mitIds = schritte.map((x, i) => (ids[i] !== undefined ? { ...x, id: ids[i] } : x));
      setSchritte(mitIds);
      setGespeichert(JSON.stringify(mitIds));
      // Anhänge entfernter Schritte sind serverseitig gelöscht
      setAnhaenge((a) => Object.fromEntries(Object.entries(a).filter(([k]) => ids.includes(Number(k)))));
      const w: string[] = data.warnungen ?? [];
      setStatus({ text: w.length ? `Gespeichert (${w.join(', ')})` : 'Gespeichert', fehler: false });
    } else setStatus({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  // Tag, an dem der Schritt frühestens nach der Erstmail rausgeht
  const tagNach = (i: number) => schritte.slice(0, i + 1).reduce((s, x) => s + x.waitDays, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        {schritte.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            Noch keine Follow-ups – es wird nur die Erstmail gesendet.
          </p>
        )}
        {schritte.map((s, i) => (
          <div
            key={i}
            onClick={() => setAktiv(i)}
            className={`rounded-lg border bg-white p-4 ${aktiv === i ? 'border-indigo-600 ring-1 ring-indigo-600' : 'border-slate-200'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Follow-up {i + 1}</h3>
              <span className="text-xs text-slate-500">frühestens Tag {tagNach(i)} nach der Erstmail</span>
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={(e) => (e.stopPropagation(), verschieben(i, -1))} disabled={i === 0} className={klein} aria-label="Nach oben">
                  ▲
                </button>
                <button type="button" onClick={(e) => (e.stopPropagation(), verschieben(i, 1))} disabled={i === schritte.length - 1} className={klein} aria-label="Nach unten">
                  ▼
                </button>
                <button type="button" onClick={(e) => (e.stopPropagation(), entfernen(i))} className={`${klein} text-red-700`}>
                  Entfernen
                </button>
              </span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              Warten
              <input
                type="number"
                min={1}
                max={60}
                value={s.waitDays}
                onChange={(e) => aendern(i, { waitDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              Tag(e) nach der vorherigen Mail, falls keine Antwort
            </label>
            {(() => {
              const gewaehlt = wahl.schritt === i ? wahl.kuerzel : STANDARD_VARIANTE;
              const v = s.varianten.find((x) => x.kuerzel === gewaehlt);
              const kuerzel = v ? v.kuerzel : STANDARD_VARIANTE;
              const text = v ? v.text : s.body;
              const betreff = v ? v.betreff : s.betreff;
              const alle = [{ kuerzel: STANDARD_VARIANTE, betreff: s.betreff, aktiv: true }, ...s.varianten];
              return (
                <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={`Varianten von Follow-up ${i + 1}`}>
                    {alle.map((x) => (
                      <button
                        key={x.kuerzel}
                        type="button"
                        role="tab"
                        aria-selected={kuerzel === x.kuerzel}
                        onClick={() => setWahl({ schritt: i, kuerzel: x.kuerzel })}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium ${kuerzel === x.kuerzel ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'} ${x.aktiv ? '' : 'opacity-60'}`}
                      >
                        {x.kuerzel}
                        {!x.aktiv && <span className="ml-1 font-normal">(inaktiv)</span>}
                        {x.betreff.trim() !== '' && <span className="ml-1 font-normal text-slate-500">· neuer Thread</span>}
                      </button>
                    ))}
                    <button type="button" onClick={() => varianteHinzufuegen(i)} disabled={s.varianten.length + 1 >= MAX_VARIANTEN} className={klein}>
                      + Variante
                    </button>
                  </div>
                  {kuerzel !== STANDARD_VARIANTE && v && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input type="checkbox" checked={v.aktiv} onChange={(e) => varianteAendern(i, kuerzel, { aktiv: e.target.checked })} />
                        Aktiv (wird für neue Follow-ups dieses Schritts verwendet)
                      </label>
                      <button type="button" onClick={() => varianteLoeschen(i, kuerzel)} className={`${klein} ml-auto text-red-700`}>
                        Variante {kuerzel} löschen
                      </button>
                    </div>
                  )}
                  <KiVorschlag
                    aktiv={kiAktiv}
                    campaignId={campaignId}
                    art="followup"
                    nr={i + 1}
                    betreffNoetig={betreff.trim() !== ''}
                    onUebernehmen={(v) => varianteAendern(i, kuerzel, { text: v.text, ...(betreff.trim() !== '' ? { betreff: v.betreff } : {}) })}
                  />
                  <label className="mt-2 block text-xs font-medium text-slate-700">
                    Eigener Betreff (optional)
                    <input
                      value={betreff}
                      onChange={(e) => varianteAendern(i, kuerzel, { betreff: e.target.value })}
                      onFocus={() => setAktiv(i)}
                      placeholder="leer = Antwort im Thread der Erstmail („Re: …“)"
                      className={`${feld} mt-1`}
                    />
                  </label>
                  <p className={`mt-1 text-xs ${betreff.trim() ? 'text-amber-700' : 'text-slate-500'}`}>
                    {betreff.trim()
                      ? 'Neuer Thread: Diese Mail geht mit eigenem Betreff als neue Unterhaltung raus (kein „Re: …“, kein Bezug zur Erstmail).'
                      : 'Ohne Betreff geht das Follow-up als „Re: …“ im selben Thread raus.'}
                  </p>
                  <textarea
                    aria-label={`Text Follow-up ${i + 1} Variante ${kuerzel}`}
                    value={text}
                    onChange={(e) => varianteAendern(i, kuerzel, { text: e.target.value })}
                    onFocus={() => setAktiv(i)}
                    rows={7}
                    className={`${feld} font-mono`}
                  />
                  <AnhangEditor
                    campaignId={campaignId}
                    followupId={s.id}
                    anhaenge={s.id !== undefined ? (anhaenge[s.id] ?? []) : []}
                    onChange={(liste) => s.id !== undefined && setAnhaenge((a) => ({ ...a, [s.id as number]: liste }))}
                    gesperrt={gesperrt}
                  />
                </div>
              );
            })()}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={hinzufuegen} disabled={schritte.length >= 10} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            + Follow-up hinzufügen
          </button>
          <button onClick={speichern} disabled={!geaendert || klammerFehler.length > 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            Follow-ups speichern
          </button>
          {status && <span className={`text-sm ${status.fehler ? 'text-red-600' : 'text-green-700'}`}>{status.text}</span>}
        </div>
        <VorlagenHinweise fehler={klammerFehler} unbekannt={unbekannt} schreibregeln={regelVerstoesse} />
        <p className="text-xs text-slate-500">
          Platzhalter wie in der Erstmail: {platzhalterFuer(mitVideo, extraSpalten).map(([p]) => p).join(' ')}. Follow-ups gehen als Antwort im selben Thread raus (Betreff „Re: …“); mit eigenem Betreff als neuer Thread. Mehrere Varianten je Schritt werden rotierend gesendet. Antwortet ein Lead oder kommt die Mail
          zurück, endet sein Flow automatisch. Tageslimit, Versandfenster und Abstand gelten auch für Follow-ups.
        </p>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Vorschau Follow-up {schritt ? aktiv + 1 : '–'}{schritt && schritt.varianten.length > 0 ? ` · Variante ${aktivVar ? aktivVar.kuerzel : STANDARD_VARIANTE}` : ''} für</span>
          <select value={leadId ?? ''} onChange={(e) => setLeadId(Number(e.target.value))} disabled={leads.length === 0} className="min-w-0 max-w-full flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm">
            {leads.length === 0 && <option>Keine Leads vorhanden</option>}
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          {varianten.length > 1 && (
            <select value={variante} onChange={(e) => setVariante(e.target.value)} aria-label="Variante der Erstmail" className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="">Variante des Leads</option>
              {varianten.map((k) => (
                <option key={k} value={k}>
                  Betreff von Variante {k}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-sm">
            <span className="text-slate-500">Betreff: </span>
            <strong>{schritt ? (preview?.subject ?? '–') : '–'}</strong>
            {schritt && vorschauBetreff.trim() !== '' && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">neuer Thread</span>}
          </div>
          <AnhangVorschau anhaenge={schritt?.id !== undefined ? (anhaenge[schritt.id] ?? []) : []} />
          <iframe title="Follow-up-Vorschau" sandbox="" srcDoc={schritt ? (preview?.html ?? '') : ''} className="h-[420px] w-full rounded-b-lg bg-white" />
        </div>
      </div>
    </div>
  );
}
