// Reine Logik der A/B-Test-Varianten (auch im Browser nutzbar, daher keine Node-/DB-Importe).

/** Variante A = die Kampagnen-Vorlage selbst */
export const STANDARD_VARIANTE = 'A';
/** Höchstens so viele Varianten insgesamt (A, B, C, D, E) */
export const MAX_VARIANTEN = 5;
const KUERZEL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Nächstes freies Kürzel (B, C …) oder null, wenn das Maximum erreicht ist. */
export function naechstesKuerzel(vergeben: string[]): string | null {
  if (vergeben.length + 1 >= MAX_VARIANTEN) return null;
  const belegt = new Set([STANDARD_VARIANTE, ...vergeben]);
  return KUERZEL.find((k) => !belegt.has(k)) ?? null;
}

/**
 * Wählt die Variante für die nächste Erstmail: unter den aktiven (A ist immer dabei) die mit den bisher
 * wenigsten Versendungen, bei Gleichstand nach Kürzel. Das ergibt gleichmäßige Rotation A, B, A, B …
 */
export function waehleVariante(aktiveKuerzel: string[], bisherGesendet: Record<string, number>): string {
  const kandidaten = [...new Set([STANDARD_VARIANTE, ...aktiveKuerzel])].sort((a, b) => a.localeCompare(b));
  let beste = kandidaten[0];
  for (const k of kandidaten) {
    if ((bisherGesendet[k] ?? 0) < (bisherGesendet[beste] ?? 0)) beste = k;
  }
  return beste;
}
