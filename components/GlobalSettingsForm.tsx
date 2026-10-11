'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Werte = {
  senderName: string;
  signature: string;
  globalDailyLimit: number;
  rampeAktiv: boolean;
  rampeStart: number;
  rampeSchritt: number;
  rampeBeginn: string;
  bounceSchwellePostfach: number;
  impressumUrl: string;
  datenschutzUrl: string;
  kiAutoStatus: 'aus' | 'vorschlagen' | 'automatisch';
  kiKlassifizierer: 'anthropic' | 'jev';
  kiEntwurfAnbieter: 'openai' | 'anthropic';
  openaiModell: string;
  jevModell: string;
};

const feld = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';

const ENTWURF_LABEL = { openai: 'OpenAI', anthropic: 'Claude (Anthropic)' } as const;
const KLASSIFIZIERER_LABEL = { jev: 'Jev (TypeSafe AI, über OpenRouter)', anthropic: 'Claude (Anthropic)' } as const;

export function GlobalSettingsForm({
  initial,
  heuteErlaubt,
  kiAktiv = false,
  klassifiziererOptionen = [],
  entwurfOptionen = [],
  modellStandard = { openai: 'gpt-5.5', jev: 'typesafe/jev-1.13' },
}: {
  initial: Werte;
  heuteErlaubt: number;
  kiAktiv?: boolean;
  /** Klassifizierer, deren API-Schlüssel gesetzt ist */
  klassifiziererOptionen?: ('anthropic' | 'jev')[];
  /** Anbieter für Texte/Entwürfe, deren API-Schlüssel gesetzt ist */
  entwurfOptionen?: ('openai' | 'anthropic')[];
  /** Standard-Modelle als Platzhalter */
  modellStandard?: { openai: string; jev: string };
}) {
  const router = useRouter();
  const [w, setW] = useState<Werte>(initial);
  const [status, setStatus] = useState<{ text: string; fehler: boolean } | null>(null);
  // Nach dem Eintragen/Entfernen von Schlüsseln ändern sich die wählbaren Anbieter: ungültige Auswahl durch den Standard ersetzen
  const klassifizierer: Werte['kiKlassifizierer'] = klassifiziererOptionen.includes(w.kiKlassifizierer) ? w.kiKlassifizierer : klassifiziererOptionen.includes('jev') ? 'jev' : (klassifiziererOptionen[0] ?? w.kiKlassifizierer);
  const entwurfAnbieter: Werte['kiEntwurfAnbieter'] = entwurfOptionen.includes(w.kiEntwurfAnbieter) ? w.kiEntwurfAnbieter : (entwurfOptionen[0] ?? w.kiEntwurfAnbieter);
  const set = <K extends keyof Werte>(k: K, v: Werte[K]) => setW((x) => ({ ...x, [k]: v }));

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...w, kiAutoStatus: klassifiziererOptionen.length ? w.kiAutoStatus : undefined, kiKlassifizierer: klassifiziererOptionen.length ? klassifizierer : undefined, kiEntwurfAnbieter: entwurfOptionen.length ? entwurfAnbieter : undefined, openaiModell: w.openaiModell, jevModell: w.jevModell, globalDailyLimit: Number(w.globalDailyLimit), rampeStart: Number(w.rampeStart), rampeSchritt: Number(w.rampeSchritt), bounceSchwellePostfach: Number(w.bounceSchwellePostfach) }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus({ text: 'Gespeichert', fehler: false });
      router.refresh();
    } else setStatus({ text: data.error ?? 'Speichern fehlgeschlagen', fehler: true });
  }

  return (
    <form onSubmit={speichern} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold">Standardwerte &amp; Versand</h2>
      <label className="block text-sm font-medium text-slate-700">
        Standard-Absendername
        <input value={w.senderName} onChange={(e) => set('senderName', e.target.value)} className={feld} placeholder="z. B. Amin Douioui" />
        <span className="mt-1 block text-xs font-normal text-slate-500">Gilt für Postfächer ohne eigenen Namen (siehe oben bei „Postfächer“).</span>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Standard-Signatur
        <textarea value={w.signature} onChange={(e) => set('signature', e.target.value)} rows={6} className={`${feld} font-mono`} placeholder={'Amin Douioui\nProzessia GmbH\nTelefon …\nImpressum: https://…'} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Gilt für Postfächer ohne eigene Signatur. Zeilenumbrüche bleiben erhalten. Hier gehören die Impressumsangaben hin.</span>
      </label>
      <label className="block text-sm font-medium text-slate-700 sm:max-w-xs">
        Gesamtlimit pro Tag über alle Postfächer
        <input required type="number" min={1} max={2000} value={w.globalDailyLimit} onChange={(e) => set('globalDailyLimit', Number(e.target.value))} className={feld} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Obergrenze für alle Kampagnen und Postfächer zusammen; jedes Postfach hat zusätzlich sein eigenes Tageslimit.</span>
      </label>
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Aufwärmrampe</legend>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={w.rampeAktiv} onChange={(e) => set('rampeAktiv', e.target.checked)} />
          <span>
            Tageslimit langsam steigern
            <span className="block text-xs text-slate-500">
              Startet mit dem Startwert und steigt täglich um den Schritt, höchstens bis zum Gesamtlimit. Gilt auch je Postfach (höchstens bis zu dessen Tageslimit), gerechnet ab der ersten Mail des Postfachs. Gut für neue Absenderadressen.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium text-slate-700">
            Startwert (Mails am 1. Tag)
            <input type="number" min={1} max={2000} value={w.rampeStart} onChange={(e) => set('rampeStart', Number(e.target.value))} className={feld} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Steigerung pro Tag
            <input type="number" min={0} max={500} value={w.rampeSchritt} onChange={(e) => set('rampeSchritt', Number(e.target.value))} className={feld} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Beginn (optional)
            <input type="date" value={w.rampeBeginn} onChange={(e) => set('rampeBeginn', e.target.value)} className={feld} />
          </label>
        </div>
        <p className="text-xs text-slate-500">Ohne Beginn zählt der Tag der ersten gesendeten Mail (noch keine: heute). Zum Übernehmen der Änderungen speichern.</p>
        <p className="text-sm font-medium text-slate-800">Heute insgesamt erlaubt: {heuteErlaubt} {heuteErlaubt === 1 ? 'Mail' : 'Mails'}</p>
      </fieldset>
      <label className="block text-sm font-medium text-slate-700 sm:max-w-xs">
        Bounce-Schwelle je Postfach (%)
        <input required type="number" min={1} max={100} value={w.bounceSchwellePostfach} onChange={(e) => set('bounceSchwellePostfach', Number(e.target.value))} className={feld} />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Liegt die Bounce-Quote der letzten 50 Erstmails eines Postfachs darüber (ab 20 gesendeten), wird das Postfach pausiert. Wieder aktivieren unter „Postfächer“.
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Impressum-URL
          <input type="url" value={w.impressumUrl} onChange={(e) => set('impressumUrl', e.target.value)} className={feld} placeholder="https://…" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Datenschutz-URL
          <input type="url" value={w.datenschutzUrl} onChange={(e) => set('datenschutzUrl', e.target.value)} className={feld} placeholder="https://…" />
        </label>
      </div>
      {kiAktiv && (
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3" aria-label="KI-Funktionen">
          <legend className="px-1 text-sm font-medium text-slate-700">KI-Funktionen</legend>
          {klassifiziererOptionen.length > 0 && (
            <label className="block text-sm font-medium text-slate-700 sm:max-w-sm">
              Modell für die Einordnung von Antworten
              <select value={klassifizierer} onChange={(e) => set('kiKlassifizierer', e.target.value as Werte['kiKlassifizierer'])} disabled={klassifiziererOptionen.length < 2} className={feld}>
                {klassifiziererOptionen.map((o) => (
                  <option key={o} value={o}>
                    {KLASSIFIZIERER_LABEL[o]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-slate-500">Zur Wahl stehen nur Modelle, deren API-Schlüssel gesetzt ist. Ohne Schlüssel für Jev oder Claude ist die Einordnung aus.</span>
            </label>
          )}
          {entwurfOptionen.length > 0 && (
            <label className="block text-sm font-medium text-slate-700 sm:max-w-sm">
              Anbieter für Texte/Entwürfe
              <select value={entwurfAnbieter} onChange={(e) => set('kiEntwurfAnbieter', e.target.value as Werte['kiEntwurfAnbieter'])} disabled={entwurfOptionen.length < 2} className={feld}>
                {entwurfOptionen.map((o) => (
                  <option key={o} value={o}>
                    {ENTWURF_LABEL[o]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-slate-500">Für „Entwurf mit KI“ (Unibox) und „KI-Vorschlag“ (Vorlagen). Zur Wahl stehen nur Anbieter, deren API-Schlüssel gesetzt ist.</span>
            </label>
          )}
          {(klassifiziererOptionen.includes('jev') || entwurfOptionen.includes('openai')) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {klassifiziererOptionen.includes('jev') && (
                <label className="block text-sm font-medium text-slate-700">
                  Jev-Modell (optional)
                  <input value={w.jevModell} onChange={(e) => set('jevModell', e.target.value)} className={`${feld} font-mono`} placeholder={modellStandard.jev} maxLength={200} autoComplete="off" />
                  <span className="mt-1 block text-xs font-normal text-slate-500">Leer = Standard. Alias: ~typesafe/jev-latest.</span>
                </label>
              )}
              {entwurfOptionen.includes('openai') && (
                <label className="block text-sm font-medium text-slate-700">
                  OpenAI-Modell (optional)
                  <input value={w.openaiModell} onChange={(e) => set('openaiModell', e.target.value)} className={`${feld} font-mono`} placeholder={modellStandard.openai} maxLength={200} autoComplete="off" />
                  <span className="mt-1 block text-xs font-normal text-slate-500">Leer = Standard. Bei „model not found“ anpassen (platform.openai.com/docs/models).</span>
                </label>
              )}
            </div>
          )}
          {klassifiziererOptionen.length > 0 && (
          <label className="block text-sm font-medium text-slate-700 sm:max-w-sm">
            Neue Antworten einordnen
            <select value={w.kiAutoStatus} onChange={(e) => set('kiAutoStatus', e.target.value as Werte['kiAutoStatus'])} className={feld}>
              <option value="aus">Aus (nur manuell per Button)</option>
              <option value="vorschlagen">Vorschlagen (Standard)</option>
              <option value="automatisch">Automatisch anwenden</option>
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Erkannte Antworten werden mit Lesezugriff auf das Postfach eingeordnet (interessiert, später, nicht interessiert, falscher Ansprechpartner, Abwesenheit, Abmeldung). „Vorschlagen“ zeigt das Ergebnis nur an. „Automatisch“
              setzt den Lead-Status (nur bei Status „Offen“), sperrt Abmeldungen wie den Abmeldelink und behandelt Abwesenheitsnotizen wie erkannte Abwesenheit – jeweils nur bei einer Sicherheit von mindestens 80 %.
            </span>
          </label>
          )}
        </fieldset>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Speichern
        </button>
        {status && <span className={`text-sm ${status.fehler ? 'text-red-600' : 'text-green-700'}`}>{status.text}</span>}
      </div>
    </form>
  );
}
