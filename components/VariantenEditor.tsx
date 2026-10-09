'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MAX_VARIANTEN, naechstesKuerzel } from '@/lib/varianten';
import { pruefeVorlage, STANDARD_VARIABLEN } from '@/lib/vorlage';
import { VorlagenHinweise } from './VorlagenHilfe';

export type VarianteEintrag = { id: number; kuerzel: string; betreff: string; text: string; aktiv: boolean; verwendet: number };
type Preview = { subject: string; text: string };

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const knopf = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

/**
 * A/B-Test: Die Kampagnen-Vorlage oben ist Variante A. Hier kommen die Varianten B, C … dazu; die Erstmails
 * rotieren gleichmäßig über alle aktiven Varianten. Follow-ups hängen sich mit „Re: …“ an den Betreff der
 * Variante, die der Lead bekommen hat.
 */
export function VariantenEditor({
  campaignId,
  initial,
  extraSpalten,
  vorschauLeadId,
}: {
  campaignId: number;
  initial: VarianteEintrag[];
  extraSpalten: string[];
  vorschauLeadId: number | null;
}) {
  const router = useRouter();
  const [liste, setListe] = useState(initial);
  const [fehlerText, setFehlerText] = useState('');
  const frei = naechstesKuerzel(liste.map((v) => v.kuerzel));

  async function anlegen() {
    setFehlerText('');
    const res = await fetch(`/api/campaigns/${campaignId}/varianten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ betreff: 'Anderer Betreff für {{firma}}', text: '{{begruessung}},\n\n{{vorschaubild}}\n\nHier steht der alternative Text.' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setFehlerText(data.error ?? 'Variante konnte nicht angelegt werden');
    setListe((l) => [...l, data.variante]);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Die Vorlage oben ist <strong>Variante A</strong>. Mit weiteren Varianten (höchstens {MAX_VARIANTEN} insgesamt) wird jede Erstmail abwechselnd mit einer der aktiven Varianten gesendet; die Auswertung steht
        auf der Kampagnenseite.
      </p>
      {liste.map((v) => (
        <VarianteKarte
          key={v.id}
          campaignId={campaignId}
          start={v}
          extraSpalten={extraSpalten}
          vorschauLeadId={vorschauLeadId}
          onGeloescht={() => {
            setListe((l) => l.filter((x) => x.id !== v.id));
            router.refresh();
          }}
          onGeaendert={() => router.refresh()}
        />
      ))}
      <div className="flex items-center gap-3">
        <button type="button" onClick={anlegen} disabled={!frei} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {frei ? `Variante ${frei} hinzufügen` : 'Maximale Anzahl Varianten erreicht'}
        </button>
        {fehlerText && <span className="text-sm text-red-600">{fehlerText}</span>}
      </div>
    </div>
  );
}

function VarianteKarte({
  campaignId,
  start,
  extraSpalten,
  vorschauLeadId,
  onGeloescht,
  onGeaendert,
}: {
  campaignId: number;
  start: VarianteEintrag;
  extraSpalten: string[];
  vorschauLeadId: number | null;
  onGeloescht: () => void;
  onGeaendert: () => void;
}) {
  const [betreff, setBetreff] = useState(start.betreff);
  const [text, setText] = useState(start.text);
  const [aktiv, setAktiv] = useState(start.aktiv);
  const [gespeichert, setGespeichert] = useState({ betreff: start.betreff, text: start.text, aktiv: start.aktiv });
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  const [vorschau, setVorschau] = useState<Preview | null>(null);
  const [zeigeVorschau, setZeigeVorschau] = useState(false);
  const bekannt = [...STANDARD_VARIABLEN, ...extraSpalten];
  const pb = pruefeVorlage(betreff, bekannt);
  const pt = pruefeVorlage(text, bekannt);
  const klammerFehler = [...pb.fehler.map((f) => `Betreff: ${f}`), ...pt.fehler.map((f) => `Text: ${f}`)];
  const unbekannt = [...new Set([...pb.unbekannt, ...pt.unbekannt])];
  const geaendert = betreff !== gespeichert.betreff || text !== gespeichert.text || aktiv !== gespeichert.aktiv;

  // Vorschau mit der aktuellen (auch ungespeicherten) Fassung dieser Variante
  useEffect(() => {
    if (!zeigeVorschau || vorschauLeadId === null) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/${vorschauLeadId}/mail-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: betreff, body: text }),
          signal: ctrl.signal,
        });
        if (res.ok) setVorschau(await res.json());
      } catch {
        // abgebrochen – nächste Änderung lädt neu
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [zeigeVorschau, vorschauLeadId, betreff, text]);

  async function speichern() {
    setStatus(null);
    const res = await fetch(`/api/campaigns/${campaignId}/varianten/${start.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ betreff, text, aktiv }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const w: string[] = data.warnungen ?? [];
      setStatus({ text: w.length ? `Gespeichert (${w.join(', ')})` : 'Gespeichert', fehler: false });
      setGespeichert({ betreff, text, aktiv });
      onGeaendert();
    } else setStatus({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  async function testmail() {
    setStatus({ text: 'Testmail wird gesendet …', fehler: false });
    if (geaendert) await speichern();
    const res = await fetch(`/api/campaigns/${campaignId}/test-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: vorschauLeadId ?? undefined, variante: start.kuerzel }),
    });
    const data = await res.json().catch(() => ({}));
    setStatus(data.ok ? { text: `Testmail an ${data.to} gesendet`, fehler: false } : { text: data.error ?? 'Testmail fehlgeschlagen', fehler: true });
  }

  async function loeschen() {
    if (!confirm(`Variante ${start.kuerzel} löschen?`)) return;
    const res = await fetch(`/api/campaigns/${campaignId}/varianten/${start.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) onGeloescht();
    else setStatus({ text: data.error ?? 'Löschen fehlgeschlagen', fehler: true });
  }

  return (
    <div className={`rounded-lg border bg-white p-4 ${aktiv ? 'border-slate-200' : 'border-slate-200 opacity-75'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">Variante {start.kuerzel}</h3>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} />
          Aktiv (wird für neue Erstmails verwendet)
        </label>
        {start.verwendet > 0 && <span className="text-xs text-slate-500">an {start.verwendet} Lead(s) gesendet</span>}
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={() => setZeigeVorschau((z) => !z)} disabled={vorschauLeadId === null} className={knopf}>
            {zeigeVorschau ? 'Vorschau ausblenden' : 'Vorschau'}
          </button>
          <button type="button" onClick={loeschen} disabled={start.verwendet > 0} title={start.verwendet > 0 ? 'Bereits verwendet – nur deaktivieren' : undefined} className={`${knopf} text-red-700`}>
            Löschen
          </button>
        </span>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Betreff
        <input value={betreff} onChange={(e) => setBetreff(e.target.value)} className={feld} />
      </label>
      <label className="mt-3 block text-sm font-medium text-slate-700">
        Text
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className={`${feld} font-mono`} />
      </label>
      <VorlagenHinweise fehler={klammerFehler} unbekannt={unbekannt} />
      {zeigeVorschau && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="mb-2">
            <span className="text-slate-500">Betreff: </span>
            <strong>{vorschau?.subject ?? '–'}</strong>
          </p>
          <pre className="whitespace-pre-wrap text-slate-800">{vorschau?.text}</pre>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={speichern} disabled={!geaendert || klammerFehler.length > 0} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          Speichern
        </button>
        <button type="button" onClick={testmail} disabled={vorschauLeadId === null || klammerFehler.length > 0} className={`${knopf} px-4 py-2 text-sm`}>
          Testmail dieser Variante
        </button>
        {status && <span className={`text-sm ${status.fehler ? 'text-red-600' : 'text-green-700'}`}>{status.text}</span>}
      </div>
    </div>
  );
}
