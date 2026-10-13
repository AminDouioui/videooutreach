// Zusammenfassung der Nicht-Bot-Aktivität eines Leads (rein, ohne DB) für das Lead-Detail.

export type AktEvent = { type: string; isBot: boolean; createdAt: Date | number };

export type Zeitreihe = { erster: number | null; letzter: number | null; anzahl: number };

export type LeadAktivitaet = {
  mailKlick: Zeitreihe;
  play: Zeitreihe;
  termin: Zeitreihe;
  /** höchster Fortschritt in % (0 = nicht gestartet/kein Fortschritt) */
  maxProgress: number;
  /** Bot-Events (z. B. Mail-Scanner), die nicht mitzählen */
  botEvents: number;
};

const PROGRESS: Record<string, number> = { progress_25: 25, progress_50: 50, progress_75: 75, progress_100: 100 };

function reihe(events: AktEvent[], type: string): Zeitreihe {
  const t = events.filter((e) => e.type === type).map((e) => +e.createdAt);
  return t.length ? { erster: Math.min(...t), letzter: Math.max(...t), anzahl: t.length } : { erster: null, letzter: null, anzahl: 0 };
}

export function fasseAktivitaetZusammen(events: AktEvent[]): LeadAktivitaet {
  const echte = events.filter((e) => !e.isBot);
  return {
    mailKlick: reihe(echte, 'video_link_click'),
    play: reihe(echte, 'play'),
    termin: reihe(echte, 'cta_click'),
    maxProgress: Math.max(0, ...echte.map((e) => PROGRESS[e.type] ?? 0)),
    botEvents: events.length - echte.length,
  };
}
