'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Quelle = { quelle: string; konfidenz: number; typ?: string };
type Zeile = {
  companyId: number;
  firma: string;
  plz: string | null;
  ort: string | null;
  domain: string | null;
  branche: string | null;
  brancheKonfidenz: number | null;
  mitarbeiter: { zahl: number | null; typ: string | null; klasse: string | null } | null;
  person: { id: number; vorname: string | null; nachname: string; rolleText: string | null; rollenTreffer: string | null; quelle: Quelle | null } | null;
  email: { adresse: string; status: string; konfidenz: number; muster: string | null; verifiziertAm: number | null; quellen: string[] } | null;
  telefone: Array<{ wert: string; art: string | null; quelle: string | null }>;
  scores: { icp: number | null; daten: number | null; gesamt: number | null };
  herkunft: Record<string, Quelle>;
  hinweise: string[];
  uebernommen: boolean;
};
type Antwort = { zeilen: Zeile[]; total: number };
type UebernahmeAntwort = { uebernommen: number; zeilen: Array<{ companyId: number; status: string; text: string }>; error?: string };

const EMAIL_BADGE: Record<string, [string, string]> = {
  gueltig: ['verifiziert', 'bg-green-100 text-green-800'],
  catch_all_best_guess: ['catch-all, unverifiziert', 'bg-amber-100 text-amber-800'],
  generisch: ['generisch (unpersönlich)', 'bg-slate-100 text-slate-700'],
  generisch_unverifiziert: ['generisch, ungeprüft', 'bg-slate-100 text-slate-700'],
};
const HINWEIS: Record<string, string> = {
  rolle_fallback: 'Fallback-Rolle (nächsthöhere)',
  catch_all: 'Catch-All-Domain',
  generisch: 'Unpersönliches Postfach',
  branche_unbekannt: 'Branche unbekannt',
  mitarbeiter_unbekannt: 'Mitarbeiterzahl unbekannt',
  rolle_offen: 'Rolle offen',
};
const BRANCHE: Record<string, string> = { werkzeugbau: 'Werkzeugbau', formenbau: 'Formenbau', maschinenbau: 'Maschinenbau', sonstige_fertigung: 'Sonstige Fertigung', keine_fertigung: 'Keine Fertigung' };
const TREFFER: Record<string, string> = { exakt: 'exakte Rolle', synonym: 'ähnliche Rolle', fallback: 'Fallback-Rolle' };
const FELD_LABEL: Record<string, string> = { name: 'Name', rechtsform: 'Rechtsform', strasse: 'Straße', plz: 'PLZ', ort: 'Ort', bundesland: 'Bundesland', domain: 'Domain', mitarbeiter: 'Mitarbeiter', branche: 'Branche' };
const MA_TYP: Record<string, string> = { exakt: 'exakt', klasse: 'Größenklasse', schaetzung: 'Schätzung' };

const feld = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600';
const prozent = (k: number) => `${Math.round(k * 100)} %`;

function Quellenzeile({ label, q }: { label: string; q: Quelle }) {
  return (
    <li>
      <span className="text-slate-500">{label}:</span> {q.quelle} <span className="text-slate-400">({prozent(q.konfidenz)}{q.typ && q.typ !== 'exakt' ? `, ${MA_TYP[q.typ] ?? q.typ}` : ''})</span>
    </li>
  );
}

/** Ergebnisliste eines Laufs: Quelle und Konfidenz je Feld, Auswahl, Übernahme in eine Kampagne, CSV-Export, Löschen einer Person. */
export function LeadgenErgebnis({ runId, kampagnen, laeuft, start }: { runId: number; kampagnen: Array<{ id: number; name: string }>; laeuft: boolean; start: { mindestScore: number; nurVerifiziert: boolean } }) {
  const [mindestScore, setMindestScore] = useState(start.mindestScore);
  const [nurVerifiziert, setNurVerifiziert] = useState(start.nurVerifiziert);
  const [daten, setDaten] = useState<Antwort>({ zeilen: [], total: 0 });
  const [auswahl, setAuswahl] = useState<Set<number>>(new Set());
  const [offen, setOffen] = useState<Set<number>>(new Set());
  const [kampagne, setKampagne] = useState<number | ''>(kampagnen[0]?.id ?? '');
  const [auchUnverifizierte, setAuchUnverifizierte] = useState(false);
  const [ergebnis, setErgebnis] = useState<UebernahmeAntwort | null>(null);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);

  const lade = useCallback(async () => {
    try {
      const res = await fetch(`/api/leadgen/runs/${runId}/ergebnisse?mindestScore=${mindestScore}&nurVerifiziert=${nurVerifiziert ? 1 : 0}&limit=500`, { cache: 'no-store' });
      if (res.ok) setDaten((await res.json()) as Antwort);
    } catch {
      // beim nächsten Takt erneut
    }
  }, [runId, mindestScore, nurVerifiziert]);

  useEffect(() => {
    lade();
    if (!laeuft) return;
    const t = setInterval(lade, 5000);
    return () => clearInterval(t);
  }, [lade, laeuft]);

  const waehlbar = useMemo(() => daten.zeilen.filter((z) => z.email && !z.uebernommen), [daten.zeilen]);
  const alleGewaehlt = waehlbar.length > 0 && waehlbar.every((z) => auswahl.has(z.companyId));

  function umschalten(set: Set<number>, id: number): Set<number> {
    const neu = new Set(set);
    if (neu.has(id)) neu.delete(id);
    else neu.add(id);
    return neu;
  }

  async function uebernehmen() {
    if (kampagne === '' || auswahl.size === 0) return;
    setBusy(true);
    setFehler('');
    setErgebnis(null);
    try {
      const res = await fetch(`/api/leadgen/runs/${runId}/uebernehmen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: kampagne, companyIds: [...auswahl], ...(auchUnverifizierte ? { statusErlaubt: ['gueltig', 'catch_all_best_guess', 'generisch', 'generisch_unverifiziert'] } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as UebernahmeAntwort;
      if (!res.ok) setFehler(data.error ?? 'Übernahme fehlgeschlagen');
      else {
        setErgebnis(data);
        setAuswahl(new Set());
        await lade();
      }
    } finally {
      setBusy(false);
    }
  }

  async function personLoeschen(z: Zeile) {
    if (!z.person) return;
    if (!confirm(`${[z.person.vorname, z.person.nachname].filter(Boolean).join(' ')} wirklich löschen? Die Daten werden entfernt, die E-Mail-Adresse kommt auf die Sperrliste, und die Person wird bei künftigen Importen blockiert. Das lässt sich nicht rückgängig machen.`)) return;
    const res = await fetch(`/api/leadgen/personen/${z.person.id}`, { method: 'DELETE' });
    if (!res.ok) setFehler((await res.json().catch(() => ({}))).error ?? 'Löschen fehlgeschlagen');
    await lade();
  }

  const csvLink = `/api/leadgen/runs/${runId}/export.csv?mindestScore=${mindestScore}&nurVerifiziert=${nurVerifiziert ? 1 : 0}${auswahl.size ? `&ids=${[...auswahl].join(',')}` : ''}`;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" data-testid="leadgen-ergebnis">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Ergebnis</h2>
        <span className="text-sm text-slate-500">{daten.total} Treffer</span>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-700">
          Mindest-Score
          <input type="number" min={0} max={100} value={mindestScore} onChange={(e) => setMindestScore(Number(e.target.value))} className={`${feld} w-20`} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={nurVerifiziert} onChange={(e) => setNurVerifiziert(e.target.checked)} />
          Nur verifizierte E-Mails
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-3 text-sm">
        <span className="font-medium">{auswahl.size} ausgewählt</span>
        <select aria-label="Kampagne" value={kampagne} onChange={(e) => setKampagne(e.target.value === '' ? '' : Number(e.target.value))} className={feld}>
          {kampagnen.length === 0 && <option value="">Keine Kampagne vorhanden</option>}
          {kampagnen.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <button onClick={uebernehmen} disabled={busy || auswahl.size === 0 || kampagne === ''} className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          In Kampagne übernehmen
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Standard: nur verifizierte Adressen. Best-Guess- und generische Adressen sind weniger zuverlässig.">
          <input type="checkbox" checked={auchUnverifizierte} onChange={(e) => setAuchUnverifizierte(e.target.checked)} />
          auch unverifizierte Adressen zulassen
        </label>
        <a href={csvLink} className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
          CSV-Export{auswahl.size ? ' (Auswahl)' : ''}
        </a>
      </div>
      <p className="mb-3 text-xs text-slate-500">Vor der Übernahme werden Dubletten (bestehende Kontakte und Kampagnen) und die Sperrliste (Opt-outs, Kunden, Blacklist, gelöschte Personen) geprüft.</p>

      {fehler && <p className="mb-2 text-sm text-red-600">{fehler}</p>}
      {ergebnis && (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm" role="status">
          <strong>{ergebnis.uebernommen} übernommen.</strong>
          {ergebnis.zeilen.filter((z) => z.status !== 'uebernommen').length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-slate-700">
              {ergebnis.zeilen
                .filter((z) => z.status !== 'uebernommen')
                .map((z) => (
                  <li key={z.companyId}>
                    {daten.zeilen.find((x) => x.companyId === z.companyId)?.firma ?? `Firma ${z.companyId}`}: {z.text}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2">
                <input type="checkbox" aria-label="Alle auswählen" checked={alleGewaehlt} onChange={(e) => setAuswahl(e.target.checked ? new Set(waehlbar.map((z) => z.companyId)) : new Set())} />
              </th>
              <th className="px-2 py-2">Firma</th>
              <th className="px-2 py-2">Ansprechpartner</th>
              <th className="px-2 py-2">E-Mail</th>
              <th className="px-2 py-2">Branche / Größe</th>
              <th className="px-2 py-2 text-right">Score</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {daten.zeilen.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-slate-500">
                  {laeuft ? 'Der Lauf arbeitet noch, Ergebnisse erscheinen hier laufend.' : 'Keine Treffer für diese Filter.'}
                </td>
              </tr>
            )}
            {daten.zeilen.map((z) => {
              const badge = z.email ? (EMAIL_BADGE[z.email.status] ?? [z.email.status, 'bg-slate-100 text-slate-700']) : null;
              const istOffen = offen.has(z.companyId);
              return (
                <FragmentZeile key={z.companyId}>
                  <tr className={z.uebernommen ? 'bg-slate-50 text-slate-400' : ''}>
                    <td className="px-2 py-2 align-top">
                      <input type="checkbox" aria-label={`${z.firma} auswählen`} disabled={!z.email || z.uebernommen} checked={auswahl.has(z.companyId)} onChange={() => setAuswahl(umschalten(auswahl, z.companyId))} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <div className="font-medium">{z.firma}</div>
                      <div className="text-xs text-slate-500">{[z.plz, z.ort].filter(Boolean).join(' ')}{z.domain ? ` · ${z.domain}` : ''}</div>
                      {z.uebernommen && <div className="text-xs">bereits in einer Kampagne</div>}
                    </td>
                    <td className="px-2 py-2 align-top">
                      {z.person ? (
                        <>
                          <div>{[z.person.vorname, z.person.nachname].filter(Boolean).join(' ')}</div>
                          <div className="text-xs text-slate-500">
                            {z.person.rolleText}
                            {z.person.rollenTreffer && z.person.rollenTreffer !== 'exakt' ? ` (${TREFFER[z.person.rollenTreffer] ?? z.person.rollenTreffer})` : ''}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">Rolle offen</span>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      {z.email && badge ? (
                        <>
                          <div className="break-all">{z.email.adresse}</div>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge[1]}`}>{badge[0]}</span>
                          <span className="ml-1 text-xs text-slate-500">{prozent(z.email.konfidenz)}</span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">keine E-Mail</span>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top text-xs text-slate-600">
                      <div>{z.branche ? `${BRANCHE[z.branche] ?? z.branche}${z.brancheKonfidenz ? ` (${prozent(z.brancheKonfidenz)})` : ''}` : '–'}</div>
                      <div>{z.mitarbeiter ? `${z.mitarbeiter.zahl ?? z.mitarbeiter.klasse} (${MA_TYP[z.mitarbeiter.typ ?? ''] ?? z.mitarbeiter.typ})` : '–'}</div>
                    </td>
                    <td className="px-2 py-2 text-right align-top" title={`ICP-Fit ${z.scores.icp ?? '–'}, Datenqualität ${z.scores.daten ?? '–'}`}>
                      <div className="font-semibold">{z.scores.gesamt ?? '–'}</div>
                      <div className="text-xs text-slate-500">
                        {z.scores.icp ?? '–'} / {z.scores.daten ?? '–'}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <button onClick={() => setOffen(umschalten(offen, z.companyId))} aria-expanded={istOffen} className="whitespace-nowrap text-xs text-indigo-600 hover:underline">
                        {istOffen ? 'Weniger' : 'Herkunft'}
                      </button>
                    </td>
                  </tr>
                  {istOffen && (
                    <tr className="bg-slate-50">
                      <td />
                      <td colSpan={6} className="px-2 py-3 text-xs text-slate-700">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <div className="mb-1 font-semibold">Firma</div>
                            <ul className="space-y-0.5">
                              {Object.entries(z.herkunft).map(([f, q]) => (
                                <Quellenzeile key={f} label={FELD_LABEL[f] ?? f} q={q} />
                              ))}
                            </ul>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold">Kontakt</div>
                            <ul className="space-y-0.5">
                              {z.person?.quelle && <Quellenzeile label="Rolle" q={z.person.quelle} />}
                              {z.email && (
                                <li>
                                  <span className="text-slate-500">E-Mail:</span> {z.email.muster ? `Muster ${z.email.muster}` : 'ohne Muster'}
                                  {z.email.verifiziertAm ? `, geprüft am ${new Date(z.email.verifiziertAm).toLocaleDateString('de-DE')}` : ', nicht verifiziert'}
                                </li>
                              )}
                              {z.email?.quellen.map((u) => (
                                <li key={u} className="break-all">
                                  <span className="text-slate-500">Quelle:</span> {u}
                                </li>
                              ))}
                              {z.telefone.map((t) => (
                                <li key={t.wert}>
                                  <span className="text-slate-500">Telefon{t.art ? ` (${t.art})` : ''}:</span> {t.wert}
                                  {t.quelle ? ` · ${t.quelle}` : ''}
                                </li>
                              ))}
                            </ul>
                            {z.hinweise.length > 0 && <p className="mt-2 text-amber-700">{z.hinweise.map((h) => HINWEIS[h] ?? h).join(' · ')}</p>}
                            {z.person && (
                              <button onClick={() => personLoeschen(z)} className="mt-2 rounded border border-red-200 px-2 py-0.5 text-red-700 hover:bg-red-50">
                                Person löschen und sperren
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </FragmentZeile>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FragmentZeile({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
