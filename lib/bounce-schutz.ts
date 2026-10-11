// Bounce-Schutz: reine Berechnung der Bounce-Quote (die Abfragen und das Pausieren liegen in bounce-schutz-db.ts)

export const BOUNCE_MINDEST_GESENDET = 20;
export const BOUNCE_SCHWELLE_STANDARD = 5;
export const BOUNCE_FENSTER_STANDARD = 50;
export const BOUNCE_FENSTER_POSTFACH = 50;
/** Beginn der Fehlermeldung eines wegen Bounces pausierten Postfachs (Fortsetzen löscht genau diese Meldungen) */
export const BOUNCE_FEHLER_PREFIX = 'Bounce-Quote zu hoch';

export type BounceQuote = {
  /** Anzahl der berücksichtigten Erstmails (höchstens `fenster`) */
  gesendet: number;
  bounces: number;
  /** 0–100, eine Nachkommastelle */
  prozent: number;
  /** Genug Mails für eine belastbare Aussage */
  ausreichend: boolean;
  /** Quote liegt über der Schwelle (nur wenn ausreichend) */
  ueberSchwelle: boolean;
};

/**
 * Bounce-Quote der zuletzt gesendeten Erstmails. `proben` = eine Angabe je Erstmail (true = gebounct), die
 * NEUESTE zuerst; berücksichtigt werden die ersten `fenster`. Unter `mindest` Mails wird nie Alarm geschlagen.
 */
export function berechneBounceQuote(proben: boolean[], opt: { schwelleProzent: number; fenster: number; mindest?: number }): BounceQuote {
  const mindest = opt.mindest ?? BOUNCE_MINDEST_GESENDET;
  const fenster = proben.slice(0, Math.max(1, Math.floor(opt.fenster)));
  const bounces = fenster.filter(Boolean).length;
  const prozent = fenster.length > 0 ? Math.round((bounces / fenster.length) * 1000) / 10 : 0;
  const ausreichend = fenster.length >= mindest;
  return { gesendet: fenster.length, bounces, prozent, ausreichend, ueberSchwelle: ausreichend && prozent > opt.schwelleProzent };
}

const zahl = (p: number) => p.toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** Grund, der bei der pausierten Kampagne angezeigt wird */
export function kampagnePausiertGrund(q: BounceQuote, schwelleProzent: number): string {
  return `Bounce-Schutz: ${zahl(q.prozent)} % Bounces (${q.bounces} von den letzten ${q.gesendet} Erstmails) – Schwelle ${zahl(schwelleProzent)} %. Bitte Adressliste prüfen, dann fortsetzen.`;
}

/** Fehlermeldung des wegen Bounces pausierten Postfachs */
export function postfachBounceFehler(q: BounceQuote): string {
  return `${BOUNCE_FEHLER_PREFIX} (${zahl(q.prozent)} %)`;
}

export function istBounceFehler(fehler: string | null | undefined): boolean {
  return !!fehler && fehler.startsWith(BOUNCE_FEHLER_PREFIX);
}
