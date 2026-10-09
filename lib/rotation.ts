import { rampenLimit } from './rampe';

// Rotation über mehrere Absender-Postfächer: reine Entscheidungslogik (ohne DB, testbar)

/** Momentaufnahme eines Postfachs für die Auswahl */
export type PostfachZustand = {
  id: number;
  aktiv: boolean;
  /** Refresh-Token vorhanden */
  verbunden: boolean;
  /** Letzter Auth-Fehler; gesetzt = pausiert bis zum Neu-Verbinden */
  fehler: string | null;
  /** Tag ('YYYY-MM-DD', Berlin), an dem ein Quota-Fehler das Postfach gestoppt hat */
  quotaGestopptAm: string | null;
  /** Frühester nächster Versand (Unix-ms) */
  nextSendAt: number | null;
  /** Effektives Tageslimit heute: min(Tageslimit, Rampe) */
  limit: number;
  /** Heute (Berlin) gesendete Mails dieses Postfachs inkl. Follow-ups */
  heuteGesendet: number;
};

export type PostfachBlock = 'inaktiv' | 'nicht_verbunden' | 'fehler' | 'quota_gestoppt' | 'limit_postfach' | 'abstand';

export type RotationOptionen = {
  /** „Jetzt senden“: den Abstand zur letzten Mail nicht beachten */
  abstandIgnorieren?: boolean;
};

/** Warum ein Postfach jetzt nicht senden darf (null = bereit). Reihenfolge = Wichtigkeit des Grundes. */
export function blockiertDurch(p: PostfachZustand, jetzt: number, heute: string, opt: RotationOptionen = {}): PostfachBlock | null {
  if (!p.aktiv) return 'inaktiv';
  if (!p.verbunden) return 'nicht_verbunden';
  if (p.fehler) return 'fehler';
  if (p.quotaGestopptAm === heute) return 'quota_gestoppt';
  if (p.heuteGesendet >= p.limit) return 'limit_postfach';
  if (!opt.abstandIgnorieren && p.nextSendAt !== null && jetzt < p.nextSendAt) return 'abstand';
  return null;
}

export type WartGrund = 'kein_postfach' | 'postfach_fehler' | 'quota_gestoppt' | 'limit_postfach' | 'abstand';

export type Auswahl = { art: 'gewaehlt'; id: number } | { art: 'warten'; grund: WartGrund };

// Welcher Grund wird gemeldet, wenn mehrere Postfächer aus verschiedenen Gründen warten? Der „kürzeste“ Weg zur
// Freigabe: Abstand (Minuten) vor Tageslimit/Quota (bis morgen) vor Fehler (Eingriff nötig) vor „keins vorhanden“.
function wartGrund(blocks: PostfachBlock[]): WartGrund {
  if (blocks.includes('abstand')) return 'abstand';
  if (blocks.includes('limit_postfach')) return 'limit_postfach';
  if (blocks.includes('quota_gestoppt')) return 'quota_gestoppt';
  if (blocks.includes('fehler')) return 'postfach_fehler';
  return 'kein_postfach';
}

/**
 * Wählt für eine Erstmail das Postfach: bereit (aktiv, verbunden, ohne Fehler, nicht quota-gestoppt, unter dem Limit,
 * Abstand erreicht) mit den wenigsten Mails heute; bei Gleichstand die kleinere ID.
 */
export function waehlePostfach(postfaecher: PostfachZustand[], jetzt: number, heute: string, opt: RotationOptionen = {}): Auswahl {
  const bereit: PostfachZustand[] = [];
  const blocks: PostfachBlock[] = [];
  for (const p of postfaecher) {
    const b = blockiertDurch(p, jetzt, heute, opt);
    if (b === null) bereit.push(p);
    else blocks.push(b);
  }
  if (bereit.length === 0) return { art: 'warten', grund: wartGrund(blocks) };
  bereit.sort((a, b) => a.heuteGesendet - b.heuteGesendet || a.id - b.id);
  return { art: 'gewaehlt', id: bereit[0].id };
}

/** Effektives Tageslimit eines Postfachs: ohne Rampe das Tageslimit, mit Rampe min(Tageslimit, Start + Schritt * Tage). */
export function postfachLimit(e: {
  tageslimit: number;
  rampe: { aktiv: boolean; start: number; schritt: number };
  /** Erster Tag der Rampe dieses Postfachs ('YYYY-MM-DD') */
  beginn: string;
  heute: string;
}): number {
  const max = Math.max(0, Math.floor(e.tageslimit));
  if (!e.rampe.aktiv) return max;
  return rampenLimit({ start: e.rampe.start, schritt: e.rampe.schritt, beginn: e.beginn, heute: e.heute, max });
}

export type PostfachStatus = 'aktiv' | 'pausiert' | 'fehler' | 'getrennt' | 'heute_gestoppt';

export const POSTFACH_STATUS_LABEL: Record<PostfachStatus, string> = {
  aktiv: 'Aktiv',
  pausiert: 'Pausiert',
  fehler: 'Fehler',
  getrennt: 'Getrennt',
  heute_gestoppt: 'Heute gestoppt',
};

/** Anzeigestatus eines Postfachs (Getrennt vor Fehler vor Pausiert vor Quota-Stopp) */
export function postfachStatus(p: Pick<PostfachZustand, 'aktiv' | 'verbunden' | 'fehler' | 'quotaGestopptAm'>, heute: string): PostfachStatus {
  if (!p.verbunden) return 'getrennt';
  if (p.fehler) return 'fehler';
  if (!p.aktiv) return 'pausiert';
  if (p.quotaGestopptAm === heute) return 'heute_gestoppt';
  return 'aktiv';
}
