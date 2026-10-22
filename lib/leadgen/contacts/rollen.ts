import { STANDARD_ROLLEN, type RollenDefinition } from '../config';
import { normalisiereText } from '../resolve/match';

// Rollen-Matching gegen eine konfigurierbare Synonymliste (Einkaufsleiter = Leiter Einkauf = Head of Procurement …).
// Fehlt die exakte Rolle, gilt die nächsthöhere passende Rolle als Fallback und wird als solcher markiert.

export type RollenTreffer = 'exakt' | 'synonym' | 'fallback' | 'keiner';
export type RollenErgebnis = { treffer: RollenTreffer; rolleKey: string | null; faktor: number };

/** Faktor, mit dem sich die Rollen-Passung auf die Konfidenz einer Person auswirkt */
export const ROLLEN_FAKTOR: Record<RollenTreffer, number> = { exakt: 1, synonym: 0.95, fallback: 0.6, keiner: 0 };

/** Weibliche und geschlechtsneutrale Endungen und Zusätze vereinheitlichen („Leiterin“ → „Leiter“, „(m/w/d)“ weg). */
export function normalisiereRollenText(roh: string): string {
  return normalisiereText(
    roh
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(m\/w\/d|w\/m\/d|m\/f\/d)\b/gi, ' '),
  )
    .replace(/\b(\w+?)(?:in|innen)\b(?=\s|$)/g, (m, stamm: string) => (/(leiter|fuehrer|manager|inhaber|vorstand|verkaeufer|gruender|werkleiter)$/.test(stamm) ? stamm : m))
    .replace(/\s+/g, ' ')
    .trim();
}

export class Rollenverzeichnis {
  private readonly nachKey = new Map<string, RollenDefinition>();
  private readonly synonymNorm: Array<{ key: string; norm: string }> = [];

  constructor(rollen: RollenDefinition[] = STANDARD_ROLLEN) {
    for (const r of rollen) {
      this.nachKey.set(r.key, r);
      for (const s of [r.label, ...r.synonyme]) this.synonymNorm.push({ key: r.key, norm: normalisiereRollenText(s) });
    }
    // Längere Synonyme zuerst: „Technischer Geschäftsführer“ soll nicht als „Geschäftsführer“ gelten, wenn es eine eigene Rolle ist
    this.synonymNorm.sort((a, b) => b.norm.length - a.norm.length);
  }

  rolle(key: string): RollenDefinition | undefined {
    return this.nachKey.get(key);
  }

  /** Welche Rolle (Schlüssel) steckt in einer Rollenbezeichnung? Das längste passende Synonym gewinnt. */
  klassifiziere(rolleText: string): { key: string; exakt: boolean } | null {
    const n = normalisiereRollenText(rolleText);
    if (!n) return null;
    for (const s of this.synonymNorm) {
      if (n === s.norm) return { key: s.key, exakt: true };
    }
    for (const s of this.synonymNorm) {
      if (` ${n} `.includes(` ${s.norm} `)) return { key: s.key, exakt: false };
    }
    return null;
  }

  /**
   * Passt die gefundene Rolle zur Zielrolle? exakt = gleiche Bezeichnung wie ein Synonym, synonym = Zielrolle steckt in der Bezeichnung
   * („Strategischer Leiter Einkauf“), fallback = nächsthöhere Rolle laut Konfiguration, sonst keiner.
   */
  vergleiche(zielKey: string, gefundenText: string): RollenErgebnis {
    const k = this.klassifiziere(gefundenText);
    if (!k) return { treffer: 'keiner', rolleKey: null, faktor: 0 };
    if (k.key === zielKey) return k.exakt ? { treffer: 'exakt', rolleKey: k.key, faktor: ROLLEN_FAKTOR.exakt } : { treffer: 'synonym', rolleKey: k.key, faktor: ROLLEN_FAKTOR.synonym };
    const ziel = this.nachKey.get(zielKey);
    if (ziel?.fallbacks.includes(k.key)) return { treffer: 'fallback', rolleKey: k.key, faktor: ROLLEN_FAKTOR.fallback };
    return { treffer: 'keiner', rolleKey: k.key, faktor: 0 };
  }
}

export const standardRollen = new Rollenverzeichnis();
