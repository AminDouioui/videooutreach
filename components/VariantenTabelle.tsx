import type { VariantenStatistik } from '@/lib/varianten-statistik';

const prozent = (r: number) => `${(r * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

/** A/B-Vergleich der Varianten: Zähler und Raten (bezogen auf gesendete Erstmails). */
export function VariantenTabelle({ statistik, mitVideo = true }: { statistik: VariantenStatistik[]; mitVideo?: boolean }) {
  const zelle = (n: number, r: number) => (
    <td className="px-3 py-2 text-right tabular-nums">
      {n} <span className="text-xs text-slate-500">({prozent(r)})</span>
    </td>
  );
  return (
    <div className="mb-4">
      <h2 className="mb-2 text-base font-semibold">A/B-Test</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Variante</th>
              <th className="px-3 py-2 text-right">Gesendet</th>
              {mitVideo && (
                <>
                  <th className="px-3 py-2 text-right">Video-Seite angesehen</th>
                  <th className="px-3 py-2 text-right">Play</th>
                  <th className="px-3 py-2 text-right">Termin-Klick</th>
                </>
              )}
              <th className="px-3 py-2 text-right">Antworten</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {statistik.map((s) => (
              <tr key={s.kuerzel}>
                <td className="px-3 py-2 font-medium">
                  {s.kuerzel}
                  {!s.aktiv && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">inaktiv</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.gesendet}</td>
                {mitVideo && (
                  <>
                    {zelle(s.angesehen, s.angesehenRate)}
                    {zelle(s.play, s.playRate)}
                    {zelle(s.terminKlick, s.terminRate)}
                  </>
                )}
                {zelle(s.antworten, s.antwortRate)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
