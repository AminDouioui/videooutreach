'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KI_KATEGORIE_LABEL, type KiKategorie } from '@/lib/ki-kategorien';

// Optionale KI-Bausteine (Schreibhilfe/Entwurf mit OPENAI_API_KEY oder ANTHROPIC_API_KEY, Einordnung mit ANTHROPIC_API_KEY oder OPENROUTER_API_KEY): Der Server reicht `aktiv` durch; ohne Schlüssel rendert nichts davon.

const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
const knopf = 'rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50';

async function post(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Keine Verbindung zum Server. Bitte erneut versuchen.' } };
  }
}

const meldung = (r: { status: number; data: Record<string, unknown> }) => (typeof r.data.error === 'string' ? r.data.error : `Die KI-Anfrage ist fehlgeschlagen (Fehler ${r.status}).`);

/**
 * Schreibhilfe: Kurzbeschreibung → Vorschlag (Betreff + Text), der erst nach „Übernehmen“ ins Feld kommt.
 * `betreffNoetig` = false: nur den Text vorschlagen (Follow-up ohne eigenen Betreff).
 */
export function KiVorschlag({
  aktiv,
  campaignId,
  art,
  nr,
  betreffNoetig = true,
  onUebernehmen,
}: {
  aktiv: boolean;
  campaignId: number;
  art: 'erstmail' | 'followup';
  nr?: number;
  betreffNoetig?: boolean;
  onUebernehmen: (v: { betreff: string; text: string }) => void;
}) {
  const [offen, setOffen] = useState(false);
  const [beschreibung, setBeschreibung] = useState('');
  const [spintax, setSpintax] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ergebnis, setErgebnis] = useState<{ betreff: string; text: string } | null>(null);
  if (!aktiv) return null;

  async function erzeugen() {
    setLaedt(true);
    setFehler(null);
    setErgebnis(null);
    const r = await post(`/api/campaigns/${campaignId}/ki/vorlage`, { beschreibung, art, nr, spintax, mitBetreff: betreffNoetig });
    setLaedt(false);
    if (r.ok && typeof r.data.text === 'string') setErgebnis({ betreff: typeof r.data.betreff === 'string' ? r.data.betreff : '', text: r.data.text });
    else setFehler(meldung(r));
  }

  return (
    <div className="my-2">
      <button type="button" onClick={() => setOffen((o) => !o)} aria-expanded={offen} className={knopf}>
        KI-Vorschlag
      </button>
      {offen && (
        <div className="mt-2 space-y-2 rounded-md border border-violet-200 bg-violet-50/50 p-3" data-testid="ki-vorschlag">
          <label className="block text-xs font-medium text-slate-700">
            Kurzbeschreibung (Angebot, Zielgruppe, Ton)
            <textarea
              value={beschreibung}
              onChange={(e) => setBeschreibung(e.target.value)}
              rows={3}
              maxLength={1500}
              placeholder="z. B. Wir automatisieren Angebotsprozesse für Maschinenbauer; Geschäftsführer; sachlich, kurz"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={spintax} onChange={(e) => setSpintax(e.target.checked)} />
            Spintax-Varianten einbauen
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={erzeugen} disabled={laedt || !beschreibung.trim()} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              {laedt ? 'Wird erzeugt …' : 'Vorschlag erzeugen'}
            </button>
            <span className="text-xs text-slate-500">Die Beschreibung geht an den gewählten KI-Anbieter (Einstellungen). Nichts wird ohne „Übernehmen“ geändert.</span>
          </div>
          {fehler && (
            <p role="alert" className="text-sm text-red-700">
              {fehler}
            </p>
          )}
          {ergebnis && (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              {betreffNoetig && (
                <p className="mb-2">
                  <span className="text-slate-500">Betreff: </span>
                  <strong className="break-words">{ergebnis.betreff}</strong>
                </p>
              )}
              <pre className="whitespace-pre-wrap break-words font-sans text-slate-800">{ergebnis.text}</pre>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onUebernehmen(ergebnis);
                    setErgebnis(null);
                    setOffen(false);
                  }}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  Übernehmen
                </button>
                <button type="button" onClick={() => setErgebnis(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  Verwerfen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type KiEinordnungDaten = { kategorie: string; konfidenz: number; begruendung: string; at: number; angewendet?: boolean; modell?: string };

/** Anzeige der gespeicherten KI-Einordnung mit „Mit KI einordnen“ und „Vorschlag übernehmen“. */
export function KiEinordnung({ aktiv, leadId, einordnung }: { aktiv: boolean; leadId: number; einordnung: KiEinordnungDaten | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  if (!aktiv) return null;
  const label = einordnung ? (KI_KATEGORIE_LABEL[einordnung.kategorie as KiKategorie] ?? einordnung.kategorie) : null;

  async function ausfuehren(name: 'einordnen' | 'uebernehmen') {
    setBusy(name);
    setFehler(null);
    setInfo(null);
    const r = await post(`/api/leads/${leadId}/ki/${name}`);
    setBusy(null);
    if (!r.ok) return setFehler(meldung(r));
    if (name === 'uebernehmen') setInfo(r.data.angewendet ? 'Übernommen.' : 'Es war nichts zu ändern.');
    router.refresh();
  }

  const kannUebernehmen = !!einordnung && einordnung.kategorie !== 'sonstiges' && !einordnung.angewendet;
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/50 p-3 text-sm" data-testid="ki-einordnung">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">KI-Einordnung</p>
      {einordnung ? (
        <div className="mt-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-900">{label}</span>
            <span className="text-xs text-slate-600">Sicherheit {Math.round(einordnung.konfidenz * 100)} %</span>
            <span className="text-xs text-slate-500">{zeit.format(new Date(einordnung.at))}</span>
            {einordnung.modell && (
              <span className="text-xs text-slate-500" data-testid="ki-modell">
                eingeordnet mit {einordnung.modell === 'jev' ? 'Jev' : 'Claude'}
              </span>
            )}
            {einordnung.angewendet ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">angewendet</span> : einordnung.kategorie !== 'sonstiges' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Vorschlag</span>}
          </p>
          <p className="mt-1 break-words text-slate-800">{einordnung.begruendung}</p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">Noch nicht eingeordnet.</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => ausfuehren('einordnen')} disabled={!!busy} className={knopf}>
          {busy === 'einordnen' ? 'Wird eingeordnet …' : einordnung ? 'Erneut mit KI einordnen' : 'Mit KI einordnen'}
        </button>
        {kannUebernehmen && (
          <button type="button" onClick={() => ausfuehren('uebernehmen')} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy === 'uebernehmen' ? 'Wird übernommen …' : 'Vorschlag übernehmen'}
          </button>
        )}
        {info && <span className="text-xs text-green-700">{info}</span>}
      </div>
      {fehler && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {fehler}
        </p>
      )}
    </div>
  );
}

/** Button „Entwurf mit KI“ für das Antwortfeld der Unibox: setzt den Text, sendet nie. */
export function KiEntwurfKnopf({ aktiv, leadId, vorhandenerText, onEntwurf }: { aktiv: boolean; leadId: number; vorhandenerText: string; onEntwurf: (text: string) => void }) {
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  if (!aktiv) return null;

  async function entwerfen() {
    if (vorhandenerText.trim() && !window.confirm('Den bisherigen Text im Antwortfeld durch den KI-Entwurf ersetzen?')) return;
    setLaedt(true);
    setFehler(null);
    const r = await post(`/api/leads/${leadId}/ki/entwurf`);
    setLaedt(false);
    if (r.ok && typeof r.data.text === 'string') onEntwurf(r.data.text);
    else setFehler(meldung(r));
  }

  return (
    <>
      <button type="button" onClick={entwerfen} disabled={laedt} className={knopf}>
        {laedt ? 'Entwurf wird erstellt …' : 'Entwurf mit KI'}
      </button>
      {fehler && (
        <p role="alert" className="basis-full text-sm text-red-700">
          {fehler}
        </p>
      )}
    </>
  );
}
