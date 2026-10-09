import Link from 'next/link';
import type { TagesPunkt, TrichterStufe } from '@/lib/analyse';

const prozent = (r: number) => `${(r * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

/** Trichter als horizontale Balken; Breite relativ zur größten Stufe, Rate bezogen auf „gesendet“. */
export function TrichterBalken({ stufen }: { stufen: TrichterStufe[] }) {
  const max = Math.max(1, ...stufen.map((s) => s.anzahl));
  return (
    <ul className="space-y-2">
      {stufen.map((s) => (
        <li key={s.key} className="grid grid-cols-[9.5rem_1fr_9rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_10rem]" title={`${s.label}: ${s.anzahl}${s.rate != null ? ` (${prozent(s.rate)})` : ''}`}>
          <span className="text-slate-700">{s.label}</span>
          <span className="h-5 rounded bg-slate-100">
            <span className="block h-5 rounded bg-indigo-500" style={{ width: `${(s.anzahl / max) * 100}%`, minWidth: s.anzahl > 0 ? '2px' : 0 }} />
          </span>
          <span className="text-right tabular-nums">
            {s.anzahl}
            {s.rate != null && <span className="ml-1 text-xs text-slate-500">({prozent(s.rate)})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SERIEN = [
  { key: 'gesendet', label: 'Gesendet', farbe: '#6366f1' },
  { key: 'angesehen', label: 'Video-Ansichten', farbe: '#10b981' },
  { key: 'antworten', label: 'Antworten', farbe: '#f59e0b' },
] as const;

/** Rundet das Maximum auf einen „glatten“ Wert (1, 2, 5, 10 …) für die Y-Achse. */
export function glatterMaximalwert(max: number): number {
  if (max <= 4) return Math.max(max, 1);
  const e = 10 ** Math.floor(Math.log10(max));
  for (const f of [1, 2, 4, 5, 10]) if (f * e >= max) return f * e;
  return 10 * e;
}

const kurz = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** Tagesverlauf als gruppiertes Balkendiagramm (inline-SVG, Tooltips per <title>). `ohneVideo` blendet die Video-Serie aus. */
export function TagesDiagramm({ tage, ohneVideo = false }: { tage: TagesPunkt[]; ohneVideo?: boolean }) {
  const serien = SERIEN.filter((s) => !(ohneVideo && s.key === 'angesehen'));
  const B = 720;
  const H = 220;
  const links = 36;
  const unten = 26;
  const oben = 8;
  const plotB = B - links - 4;
  const plotH = H - unten - oben;
  const max = glatterMaximalwert(Math.max(0, ...tage.flatMap((t) => serien.map((s) => t[s.key]))));
  const gruppe = plotB / Math.max(1, tage.length);
  const balken = Math.max(1.5, (gruppe * 0.8) / serien.length);
  const y = (v: number) => oben + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max].filter((v, i, a) => a.indexOf(v) === i);
  const labelAbstand = tage.length > 16 ? 5 : 2;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {serien.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.farbe }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${B} ${H}`} className="w-full" role="img" aria-label="Tagesverlauf">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={links} x2={B - 4} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
            <text x={links - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#64748b">
              {Number.isInteger(v) ? v : v.toLocaleString('de-DE')}
            </text>
          </g>
        ))}
        {tage.map((t, i) => {
          const x0 = links + i * gruppe + (gruppe - balken * serien.length) / 2;
          const tip = `${kurz(t.datum)}: ${serien.map((s) => `${s.label} ${t[s.key]}`).join(', ')}`;
          return (
            <g key={t.datum}>
              <title>{tip}</title>
              <rect x={links + i * gruppe} y={oben} width={gruppe} height={plotH} fill="transparent" />
              {serien.map((s, j) => (
                <rect key={s.key} x={x0 + j * balken} y={y(t[s.key])} width={balken - 0.5} height={plotH + oben - y(t[s.key])} fill={s.farbe} rx="1" />
              ))}
              {(tage.length - 1 - i) % labelAbstand === 0 && (
                <text x={links + i * gruppe + gruppe / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">
                  {kurz(t.datum)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Kennzahl-Kachel */
export function Kachel({ label, wert, hinweis, href }: { label: string; wert: string | number; hinweis?: string; href?: string }) {
  const inhalt = (
    <>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{wert}</div>
      {hinweis && <div className="mt-0.5 text-xs text-slate-500">{hinweis}</div>}
    </>
  );
  const klassen = 'block rounded-lg border border-slate-200 bg-white p-3';
  return href ? (
    <Link href={href} className={`${klassen} hover:border-indigo-300`}>
      {inhalt}
    </Link>
  ) : (
    <div className={klassen}>{inhalt}</div>
  );
}
