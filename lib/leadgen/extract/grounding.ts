import { entschleiere, extrahiereEmails, extrahiereTelefone } from './deterministic';
import { normalisiereText } from '../resolve/match';
import { normalisiereTelefon } from '../normalize/telefon';

// Grounding-Check: Jeder vom LLM gelieferte Wert (Name, Nummer, E-Mail, Rolle) muss im Quelltext tatsächlich vorkommen,
// sonst wird er verworfen. Das LLM darf zuordnen, aber nichts erfinden.

export type GroundingKontext = {
  /** Normalisierter Text (ohne Umlaute und Satzzeichen), Wörter durch Leerzeichen getrennt */
  norm: string;
  emails: Set<string>;
  telefone: Set<string>;
};

export function groundingKontext(text: string): GroundingKontext {
  return {
    norm: ` ${normalisiereText(text)} `,
    emails: new Set(extrahiereEmails(text)),
    telefone: new Set(extrahiereTelefone(text).map((t) => t.e164)),
  };
}

function wortImText(ctx: GroundingKontext, wort: string): number[] {
  const w = normalisiereText(wort);
  if (!w) return [];
  const stellen: number[] = [];
  let i = ctx.norm.indexOf(` ${w} `);
  while (i >= 0) {
    stellen.push(i);
    i = ctx.norm.indexOf(` ${w} `, i + 1);
  }
  return stellen;
}

/**
 * Name steht im Text: der Nachname als ganzes Wort, und der Vorname (oder dessen Initial) in unmittelbarer Nähe davor oder danach
 * („Hans Müller“, „Müller, Hans“, „Dr. Hans Müller“, „H. Müller“). Fehlt der Vorname, genügt der Nachname.
 */
export function nameImText(ctx: GroundingKontext, vorname: string | null, nachname: string): boolean {
  const stellen = wortImText(ctx, nachname);
  if (!stellen.length) return false;
  const v = normalisiereText(vorname ?? '');
  if (!v) return true;
  const ersteVornamen = v.split(' ')[0];
  return stellen.some((pos) => {
    const davor = ctx.norm.slice(Math.max(0, pos - 60), pos);
    const danach = ctx.norm.slice(pos + normalisiereText(nachname).length + 2, pos + normalisiereText(nachname).length + 40);
    const fenster = `${davor} ${danach}`;
    return new RegExp(`(^| )${ersteVornamen}( |$)`).test(fenster) || new RegExp(`(^| )${ersteVornamen[0]}( |$)`).test(davor.slice(-6));
  });
}

export function emailImText(ctx: GroundingKontext, email: string): boolean {
  return ctx.emails.has(entschleiere(email).toLowerCase().trim());
}

export function telefonImText(ctx: GroundingKontext, nummer: string): boolean {
  const nr = normalisiereTelefon(nummer);
  return !!nr && ctx.telefone.has(nr.e164);
}

/** Rollenbezeichnung (oder ihre Wörter in dieser Reihenfolge) steht im Text. */
export function rolleImText(ctx: GroundingKontext, rolle: string): boolean {
  const r = normalisiereText(rolle);
  return !!r && ctx.norm.includes(` ${r} `);
}

/** Beliebiges Zitat steht (normalisiert) im Text, z. B. der Beleg einer Branchenzuordnung. */
export function zitatImText(ctx: GroundingKontext, zitat: string): boolean {
  const z = normalisiereText(zitat);
  return z.length >= 8 && ctx.norm.includes(` ${z} `);
}
