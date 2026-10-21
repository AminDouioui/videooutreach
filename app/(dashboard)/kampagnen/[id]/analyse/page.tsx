import { Fragment } from 'react';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Kachel, TagesDiagramm, TrichterBalken } from '@/components/AnalyseDiagramme';
import { VariantenTabelle } from '@/components/VariantenTabelle';
import { ladeKampagnenAnalyse } from '@/lib/analyse';
import { kampagnenExtraSpalten } from '@/lib/campaigns';
import { gruppiereNachSegment, ladeEinwandVerteilung, ladeSegmentLeads, segmentFelder } from '@/lib/segment-analyse';
import { getDb, schema } from '@/lib/db';
import { leadStatusLabel } from '@/lib/lead-status';
import { ladeFollowups } from '@/lib/send';
import { ladeVariantenStatistik } from '@/lib/varianten-statistik';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

const prozent = (r: number) => `${(r * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

export default async function AnalysePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ segment?: string }> }) {
  await erforderSeitenRolle();
  const id = Number((await params).id);
  const segmentParam = (await searchParams).segment;
  if (!Number.isInteger(id)) notFound();
  const k = getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) notFound();

  const followups = ladeFollowups(id).length;
  const { trichter, schritte, tage, postfaecher } = ladeKampagnenAnalyse(id, 1 + followups);
  const stufen = trichter.stufen.filter((s) => (k.mitVideo || !s.video) && (k.linkTracking || s.key !== 'linkklick'));
  const stufe = (key: string) => trichter.stufen.find((s) => s.key === key)!;
  const varianten = ladeVariantenStatistik(id);
  const gefuellteStatus = trichter.statusVerteilung.filter((s) => s.anzahl > 0);
  const th = 'px-3 py-2 text-right';
  const felder = segmentFelder(kampagnenExtraSpalten(id));
  const gewaehlt = felder.find((f) => f.key === segmentParam) ?? felder[0];
  const segmente = gruppiereNachSegment(ladeSegmentLeads(id), gewaehlt.key);
  const einwaende = ladeEinwandVerteilung(id);

  return (
    <div>
      <p className="mb-1 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">
          Kampagnen
        </Link>{' '}
        /{' '}
        <Link href={`/kampagnen/${id}`} className="text-slate-500 hover:underline">
          {k.name}
        </Link>{' '}
        / Analyse
      </p>
      <h1 className="mb-1 text-xl font-semibold">Analyse</h1>
      <p className="mb-4 text-sm text-slate-500">Raten beziehen sich auf gesendete Erstmails. Bot-Zugriffe sind nicht eingerechnet.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kachel label="Leads" wert={trichter.stufen[0].anzahl} />
        <Kachel label="Erstmails gesendet" wert={trichter.gesendet} />
        <Kachel label="Antworten" wert={trichter.antworten} hinweis={`Antwortrate ${prozent(stufe('antwort').rate ?? 0)}`} />
        {k.mitVideo && <Kachel label="Video-Seite angesehen" wert={stufe('angesehen').anzahl} hinweis={prozent(stufe('angesehen').rate ?? 0)} />}
        {k.mitVideo && <Kachel label="Termin-Klicks" wert={stufe('termin').anzahl} hinweis={prozent(stufe('termin').rate ?? 0)} />}
        {k.linkTracking && <Kachel label="Link-Klicks" wert={stufe('linkklick').anzahl} hinweis={prozent(stufe('linkklick').rate ?? 0)} />}
        <Kachel label="Bounces" wert={trichter.bounces} hinweis={prozent(trichter.bounceRate)} />
        <Kachel label="Abwesenheiten" wert={trichter.abwesenheiten} hinweis="zählen nicht als Antwort" />
        <Kachel label="Abmeldungen" wert={trichter.abmeldungen} hinweis={prozent(trichter.abmeldeRate)} />
      </div>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold">Trichter</h2>
        {trichter.gesendet === 0 && <p className="mb-3 text-sm text-slate-500">Noch keine Erstmail gesendet.</p>}
        <TrichterBalken stufen={stufen} />
        {gefuellteStatus.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-sm font-medium text-slate-700">Lead-Status</h3>
            <div className="flex flex-wrap gap-2 text-sm">
              {gefuellteStatus.map((s) => (
                <span key={s.status} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  {leadStatusLabel(s.status)} <strong className="tabular-nums">{s.anzahl}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">Schritte</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Schritt</th>
                <th className={th}>Gesendet</th>
                <th className={th} title="Antwort zählt dem letzten vor der Antwort gesendeten Schritt zu">
                  Antworten danach
                </th>
                <th className={th}>Antwortrate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schritte.map((s) => (
                <Fragment key={s.step}>
                  <tr>
                    <td className="px-3 py-2 font-medium">{s.label}</td>
                    <td className={`${th} tabular-nums`}>{s.gesendet}</td>
                    <td className={`${th} tabular-nums`}>{s.antworten}</td>
                    <td className={`${th} tabular-nums`}>{s.gesendet > 0 ? prozent(s.antwortRate) : '–'}</td>
                  </tr>
                  {s.varianten.length > 1 &&
                    s.varianten.map((v) => (
                      <tr key={`${s.step}-${v.kuerzel}`} className="bg-slate-50/60 text-slate-600">
                        <td className="py-1.5 pl-7 pr-3">Variante {v.kuerzel}</td>
                        <td className={`${th} py-1.5 tabular-nums`}>{v.gesendet}</td>
                        <td className={`${th} py-1.5 tabular-nums`}>{v.antworten}</td>
                        <td className={`${th} py-1.5 tabular-nums`}>{v.gesendet > 0 ? prozent(v.antwortRate) : '–'}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {postfaecher.length > 1 && (
        <section className="mb-6">
          <h2 className="mb-2 text-base font-semibold">Postfächer</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Postfach</th>
                  <th className={th}>Gesendet</th>
                  <th className={th} title="Davon Erstmails (Basis der Antwortrate)">
                    Erstmails
                  </th>
                  <th className={th}>Antworten</th>
                  <th className={th}>Antwortrate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {postfaecher.map((p) => (
                  <tr key={p.absenderId ?? 'ohne'}>
                    <td className="px-3 py-2 font-medium">{p.absenderId === null ? 'Ohne Zuordnung' : (p.email ?? `Postfach ${p.absenderId}`)}</td>
                    <td className={`${th} tabular-nums`}>{p.gesendet}</td>
                    <td className={`${th} tabular-nums`}>{p.erstmails}</td>
                    <td className={`${th} tabular-nums`}>{p.antworten}</td>
                    <td className={`${th} tabular-nums`}>{p.erstmails > 0 ? prozent(p.antwortRate) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold">Letzte 30 Tage</h2>
        <TagesDiagramm tage={tage} ohneVideo={!k.mitVideo} />
        <p className="mt-2 text-xs text-slate-500">Berliner Tage. Video-Ansichten = Leads, die die Video-Seite an diesem Tag erstmals aufgerufen haben.</p>
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="segment-auswertung">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Auswertung nach Segment</h2>
        <p className="mb-3 text-xs text-slate-500">Wo funktioniert die Kampagne am besten? Raten beziehen sich auf gesendete Erstmails des Segments. Positiv = interessiert, Termin gebucht oder gewonnen.</p>
        <div className="mb-3 flex flex-wrap gap-2" role="tablist">
          {felder.map((f) => (
            <Link key={f.key} href={`?segment=${encodeURIComponent(f.key)}`} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${f.key === gewaehlt.key ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {f.label}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">{gewaehlt.label}</th>
                <th className={th}>Leads</th>
                <th className={th}>Gesendet</th>
                {k.mitVideo && <th className={th}>Angesehen</th>}
                {k.mitVideo && <th className={th}>Termin-Klicks</th>}
                <th className={th}>Antworten</th>
                <th className={th}>Antwortrate</th>
                <th className={th}>Positiv</th>
              </tr>
            </thead>
            <tbody>
              {segmente.map((z) => (
                <tr key={z.segment} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{z.segment}</td>
                  <td className={th}>{z.leads}</td>
                  <td className={th}>{z.gesendet}</td>
                  {k.mitVideo && <td className={th}>{z.angesehen}</td>}
                  {k.mitVideo && <td className={th}>{z.termin}</td>}
                  <td className={th}>{z.antworten}</td>
                  <td className={th}>{z.antwortRate === null ? '–' : prozent(z.antwortRate)}</td>
                  <td className={th}>
                    {z.positiv}
                    {z.positivRate !== null && <span className="ml-1 text-xs text-slate-500">({prozent(z.positivRate)})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {einwaende.length > 0 && (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="einwand-auswertung">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Einwände in den Antworten</h2>
          <p className="mb-3 text-xs text-slate-500">Von der KI erkannt. Daran lassen sich Vorlagen und Konter ausrichten.</p>
          <ul className="space-y-1 text-sm">
            {einwaende.map((e) => (
              <li key={e.einwand} className="flex justify-between border-b border-slate-100 py-1">
                <span>{e.label}</span>
                <span className="font-medium tabular-nums">{e.anzahl}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {k.abAuto && (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="ab-auto-protokoll">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">A/B-Automatik</h2>
          {(k.abAutoLog ?? []).length === 0 ? (
            <p className="text-sm text-slate-600">Eingeschaltet. Noch keine Entscheidung: bewertet wird ab 40 gesendeten Mails je Variante, nur bei statistisch deutlichem Unterschied.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...(k.abAutoLog ?? [])].reverse().map((l, i) => (
                <li key={i} className="border-b border-slate-100 py-1">
                  <span className="mr-2 text-xs tabular-nums text-slate-500">{new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(l.at)}</span>
                  <strong>Variante {l.kuerzel}:</strong> {l.grund}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {varianten.length > 1 && <VariantenTabelle statistik={varianten} mitVideo={k.mitVideo} />}
    </div>
  );
}
