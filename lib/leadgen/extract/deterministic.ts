import { findPhoneNumbersInText } from 'libphonenumber-js/max';
import { normalisiereTelefon, type TelefonTyp } from '../normalize/telefon';
import { parseRegister, type Registerangabe } from '../normalize/register';

// Stufe 5a: deterministische Extraktion (Regex und libphonenumber). Das LLM sieht davon nur das Ergebnis und ordnet es zu.

const BILD_ENDUNGEN = /\.(png|jpe?g|gif|svg|webp|ico|css|js)$/i;

/** Verschleierte Schreibweisen („name (at) firma [dot] de“) zurück in die normale Form. */
export function entschleiere(text: string): string {
  return text
    .replace(/\s*[(\[{]\s*(?:at|ät|@)\s*[)\]}]\s*/gi, '@')
    .replace(/\s*[(\[{]\s*(?:dot|punkt)\s*[)\]}]\s*/gi, '.')
    .replace(/\s+(?:\[at\]|\(at\)|\{at\})\s+/gi, '@')
    .replace(/&#0*64;|&commat;/gi, '@');
}

export function extrahiereEmails(text: string): string[] {
  const treffer = entschleiere(text).match(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi) ?? [];
  const aus = new Set<string>();
  for (const roh of treffer) {
    const mail = roh.toLowerCase().replace(/[.,;:]+$/, '');
    if (BILD_ENDUNGEN.test(mail)) continue;
    // Platzhalter wie „name@example.com“ oder „ihre@mail.de“ sind keine Kontakte
    if (/@(example|beispiel|domain|email|mail)\.(com|de|org)$/.test(mail) || /^(name|vorname|nachname|ihre|ihr|user|mustermann)@/.test(mail)) continue;
    aus.add(mail);
  }
  return [...aus];
}

export type TelefonFund = { e164: string; national: string; typ: TelefonTyp; roh: string; kontext: string; art: 'fax' | 'zentrale' | 'durchwahl' | 'mobil' | 'unbekannt' };

/** Findet Rufnummern im Text; das Wort davor („Fax“, „Mobil“, „Zentrale“, „Durchwahl“) bestimmt die Art, sonst der Nummerntyp. */
export function extrahiereTelefone(text: string): TelefonFund[] {
  const gefunden = new Map<string, TelefonFund>();
  for (const f of findPhoneNumbersInText(text, 'DE')) {
    const roh = text.slice(f.startsAt, f.endsAt);
    const nr = normalisiereTelefon(roh);
    if (!nr) continue;
    const kontext = text.slice(Math.max(0, f.startsAt - 24), f.startsAt).replace(/\s+/g, ' ').trim();
    const k = kontext.toLowerCase();
    const art: TelefonFund['art'] = /fax/.test(k) ? 'fax' : /mobil|handy/.test(k) || nr.typ === 'mobil' ? 'mobil' : /durchwahl|direkt|dw\b/.test(k) ? 'durchwahl' : /zentrale|telefon|tel\b|fon\b|phone/.test(k) ? 'zentrale' : 'unbekannt';
    const bisher = gefunden.get(nr.e164);
    // Faxnummer mit gleicher Nummer wie ein Telefon nie als Fax verbuchen, wenn dieselbe Nummer auch anders vorkommt
    if (!bisher || (bisher.art === 'fax' && art !== 'fax') || (bisher.art === 'unbekannt' && art !== 'unbekannt')) gefunden.set(nr.e164, { e164: nr.e164, national: nr.national, typ: nr.typ, roh, kontext, art });
  }
  return [...gefunden.values()];
}

export function extrahiereUstId(text: string): string | null {
  const m = /\b(?:USt\.?-?\s?Id(?:Nr)?\.?[:\s-]*)?(DE)\s?(\d{3})\s?(\d{3})\s?(\d{3})\b/i.exec(text);
  return m ? `DE${m[2]}${m[3]}${m[4]}` : null;
}

/** Registerangabe aus dem Impressum („Amtsgericht Stuttgart, HRB 12345“, „Registergericht: Stuttgart“ + „Handelsregisternummer: HRB 12345“). */
export function extrahiereRegister(text: string): Registerangabe | null {
  const flach = text.replace(/\s+/g, ' ');
  const nr = /\b(HRB|HRA|GnR|PR|VR)\s*(\d{1,7})/i.exec(flach);
  if (!nr) return null;
  const naeheDavor = flach.slice(Math.max(0, nr.index - 80), nr.index + nr[0].length + 20);
  const gericht = parseRegister(naeheDavor).gericht ?? parseRegister(flach).gericht;
  return { art: nr[1].toUpperCase().replace('GNR', 'GnR'), nummer: nr[2], gericht };
}

/**
 * Mitarbeiterzahl, wie die Firma sie selbst nennt („Über 250 Mitarbeitende“, „ca. 1.200 Beschäftigte“). Nur eine Selbstauskunft der
 * Webseite und damit höchstens eine Schätzung; die Zahl muss im Text stehen. Unplausible Werte (unter 5, über 200.000) werden verworfen.
 */
export function extrahiereMitarbeiter(text: string): { zahl: number; ungefaehr: boolean } | null {
  const m = /(ca\.?|circa|rund|über|mehr als|knapp)?\s*(\d{1,3}(?:[. ]\d{3})+|\d{1,6})\s*\+?\s*(?:fest angestellte[n]?\s+)?(?:Mitarbeiter(?:innen)?|Mitarbeitende[n]?|Beschäftigte[n]?|Angestellte[n]?|Kolleginnen und Kollegen)\b/i.exec(text);
  if (!m) return null;
  const zahl = Number(m[2].replace(/[. ]/g, ''));
  if (!Number.isFinite(zahl) || zahl < 5 || zahl > 200_000) return null;
  return { zahl, ungefaehr: !!m[1] || /\+/.test(m[0]) };
}
