import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Kachel, TagesDiagramm, TrichterBalken } from '@/components/AnalyseDiagramme';
import { VariantenTabelle } from '@/components/VariantenTabelle';
import { ladeKampagnenAnalyse } from '@/lib/analyse';
import { getDb, schema } from '@/lib/db';
import { leadStatusLabel } from '@/lib/lead-status';
import { ladeFollowups } from '@/lib/send';
import { ladeVariantenStatistik } from '@/lib/varianten-statistik';

export const dynamic = 'force-dynamic';

const prozent = (r: number) => `${(r * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

export default async function AnalysePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const k = getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) notFound();

  const followups = ladeFollowups(id).length;
  const { trichter, schritte, tage, postfaecher } = ladeKampagnenAnalyse(id, 1 + followups);
  const stufen = trichter.stufen.filter((s) => k.mitVideo || !s.video);
  const stufe = (key: string) => trichter.stufen.find((s) => s.key === key)!;
  const varianten = ladeVariantenStatistik(id);
  const gefuellteStatus = trichter.statusVerteilung.filter((s) => s.anzahl > 0);
  const th = 'px-3 py-2 text-right';

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
        <Kachel label="Bounces" wert={trichter.bounces} hinweis={prozent(trichter.bounceRate)} />
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
                <tr key={s.step}>
                  <td className="px-3 py-2 font-medium">{s.label}</td>
                  <td className={`${th} tabular-nums`}>{s.gesendet}</td>
                  <td className={`${th} tabular-nums`}>{s.antworten}</td>
                  <td className={`${th} tabular-nums`}>{s.gesendet > 0 ? prozent(s.antwortRate) : '–'}</td>
                </tr>
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

      {varianten.length > 1 && <VariantenTabelle statistik={varianten} mitVideo={k.mitVideo} />}
    </div>
  );
}
