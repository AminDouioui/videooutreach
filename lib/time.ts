// Zeit-Helfer für Europe/Berlin (nur Intl, keine Zusatz-Lib)

const ZONE = 'Europe/Berlin';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

export type BerlinTeile = { datum: string; stunde: number; minute: number; wochentag: number };

const WOCHENTAGE: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Zerlegt einen Zeitpunkt in Berliner Ortszeit (wochentag: 1 = Montag … 7 = Sonntag). */
export function berlinTeile(jetzt: Date = new Date()): BerlinTeile {
  const t: Record<string, string> = {};
  for (const p of fmt.formatToParts(jetzt)) t[p.type] = p.value;
  return {
    datum: `${t.year}-${t.month}-${t.day}`,
    stunde: Number(t.hour),
    minute: Number(t.minute),
    wochentag: WOCHENTAGE[t.weekday] ?? 1,
  };
}

/** Heutiges Datum in Berlin als 'YYYY-MM-DD'. */
export function todayBerlin(jetzt: Date = new Date()): string {
  return berlinTeile(jetzt).datum;
}

/** Mo–Fr in Berlin? */
export function isWeekday(jetzt: Date = new Date()): boolean {
  return berlinTeile(jetzt).wochentag <= 5;
}

/** 'HH:MM' → Minuten seit Mitternacht (NaN bei ungültigem Format). */
export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return NaN;
  return h * 60 + min;
}

export type FensterKampagne = { sendWindowStart: string; sendWindowEnd: string; sendWeekdaysOnly: boolean };

/** Liegt `jetzt` im Versandfenster der Kampagne (Start inklusive, Ende exklusive)? */
export function isWithinWindow(k: FensterKampagne, jetzt: Date = new Date()): boolean {
  const t = berlinTeile(jetzt);
  if (k.sendWeekdaysOnly && t.wochentag > 5) return false;
  const start = parseHHMM(k.sendWindowStart);
  const ende = parseHHMM(k.sendWindowEnd);
  if (Number.isNaN(start) || Number.isNaN(ende)) return false;
  const minuten = t.stunde * 60 + t.minute;
  return minuten >= start && minuten < ende;
}

/**
 * Liegt `jetzt` im Render-Fenster „HH:MM-HH:MM“ (Berlin, Start inklusive, Ende exklusive)?
 * Fenster über Mitternacht (z. B. 22:00-06:00) sind erlaubt. Kein Fenster = immer.
 */
export function isInRenderWindow(fenster: string | undefined, jetzt: Date = new Date()): boolean {
  if (!fenster) return true;
  const [a, b] = fenster.split('-');
  const start = parseHHMM(a ?? '');
  const ende = parseHHMM(b ?? '');
  if (Number.isNaN(start) || Number.isNaN(ende)) return true;
  const t = berlinTeile(jetzt);
  const minuten = t.stunde * 60 + t.minute;
  return start <= ende ? minuten >= start && minuten < ende : minuten >= start || minuten < ende;
}

/** Formatiert einen Zeitpunkt für die Anzeige („08.10.2026, 09:15“) in Berliner Zeit. */
export function formatBerlin(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, dateStyle: 'short', timeStyle: 'short' }).format(d);
}

/** Beginn des heutigen Berliner Tages als Unix-ms (für Zählungen über sent_at). */
export function startOfDayBerlinMs(jetzt: Date = new Date()): number {
  const datum = todayBerlin(jetzt);
  const [y, m, d] = datum.split('-').map(Number);
  // Mitternacht Berlin: UTC-Mitternacht minus Offset; Offset an diesem Tag per Probe bestimmen
  const utcMitternacht = Date.UTC(y, m - 1, d);
  for (const offsetH of [2, 1]) {
    const kandidat = utcMitternacht - offsetH * 3600_000;
    const t = berlinTeile(new Date(kandidat));
    if (t.datum === datum && t.stunde === 0 && t.minute === 0) return kandidat;
  }
  return utcMitternacht - 3600_000;
}
