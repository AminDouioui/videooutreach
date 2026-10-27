import { eq } from 'drizzle-orm';
import { ladeThread, leadThreads } from './antworten';
import { getDb, schema } from './db';
import { getEnv } from './env';
import type { ThreadLader } from './gmail';
import { getSetting } from './settings';
import type { ThreadNachricht } from './mail-parse';
import { todayBerlin } from './time';

// Vertretung bei Abwesenheit: Trifft in dem Zeitraum eine Antwort eines Leads ein, entsteht ein Weiterleitungs-Entwurf
// an die zuständigen Personen (Technik oder Firma) und erscheint im Dashboard. Es wird nie automatisch gesendet.

export type VertretungKategorie = 'technik' | 'firma';

export const STANDARD_VON = '2026-10-24';
export const STANDARD_BIS = '2026-10-31';
export const STANDARD_TECHNIK = ['L.szalai@haveraustralia.com.au', 'r.sukumaran@haveraustralia.com.au'];
export const STANDARD_FIRMA = ['c.maclaren@haveraustralia.com.au'];

export const KATEGORIE_LABEL: Record<VertretungKategorie, string> = { technik: 'Technischer Support', firma: 'Firmenangelegenheit' };

// Hinweise auf ein technisches Problem (Video, Link, Zustellung, Zugang); alles andere gilt als Firmenangelegenheit
const TECHNIK = /\b(video\w*|abspiel\w*|laedt|lädt|ladefehler|link\s+(funktioniert|geht)\s+nicht|funktioniert\s+nicht|geht\s+nicht|fehler\w*|error|bug|st[oö]rung|technisch\w*|support|login|passwort|zugang|zugriff|browser|app|bild\s+(fehlt|kommt)|nicht\s+(angezeigt|sichtbar|erreichbar|abspielbar)|broken|not\s+working|doesn'?t\s+work|can'?t\s+(open|play|view)|technical)\b/i;

/** Technisch oder Firmenangelegenheit? Betreff und Text der Antwort werden nach Stichworten durchsucht. */
export function klassifiziereVertretung(betreff: string, text: string): VertretungKategorie {
  return TECHNIK.test(`${betreff}\n${text}`) ? 'technik' : 'firma';
}

function liste(wert: string | null, standard: string[]): string[] {
  const l = (wert ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return l.length > 0 ? l : standard;
}

export type VertretungKonfig = { aktiv: boolean; von: string; bis: string; technik: string[]; firma: string[] };

export function vertretungKonfig(): VertretungKonfig {
  const datum = (v: string | null, std: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : std);
  return {
    aktiv: getSetting('vertretung_aktiv') !== '0',
    von: datum(getSetting('vertretung_von'), STANDARD_VON),
    bis: datum(getSetting('vertretung_bis'), STANDARD_BIS),
    technik: liste(getSetting('vertretung_technik'), STANDARD_TECHNIK),
    firma: liste(getSetting('vertretung_firma'), STANDARD_FIRMA),
  };
}

/** Liegt der Zeitpunkt (Berliner Tag) im Zeitraum, beide Tage eingeschlossen? */
export function imVertretungszeitraum(k: Pick<VertretungKonfig, 'aktiv' | 'von' | 'bis'>, jetzt: Date): boolean {
  if (!k.aktiv) return false;
  const tag = todayBerlin(jetzt);
  return tag >= k.von && tag <= k.bis;
}

type Lead = typeof schema.leads.$inferSelect;

/** Text der letzten Nachricht, die nicht von uns stammt (ohne Zitat) */
function letzteFremde(nachrichten: ThreadNachricht[]): ThreadNachricht | null {
  return [...nachrichten].reverse().find((n) => !n.eigene && n.text.trim()) ?? null;
}

const MAX_ZITAT = 4000;

export function baueEntwurf(lead: Pick<Lead, 'id' | 'firma' | 'vorname' | 'nachname' | 'email'>, kampagne: string, kategorie: VertretungKategorie, betreff: string, antwort: string | null, appUrl: string, k: Pick<VertretungKonfig, 'von' | 'bis'>): { betreff: string; text: string } {
  const name = [lead.vorname, lead.nachname].filter(Boolean).join(' ');
  const text = [
    'Hallo,',
    '',
    `ich bin vom ${k.von.split('-').reverse().join('.')} bis ${k.bis.split('-').reverse().join('.')} auf Geschäftsreise. Bitte übernehmt die folgende Antwort aus unserer Video-Outreach-Kampagne (${KATEGORIE_LABEL[kategorie]}).`,
    '',
    `Firma: ${lead.firma}`,
    `Kontakt: ${name ? `${name}, ` : ''}${lead.email}`,
    `Kampagne: ${kampagne}`,
    `Im Dashboard: ${appUrl.replace(/\/$/, '')}/antworten?lead=${lead.id}`,
    '',
    antwort ? `Antwort des Kontakts${betreff ? ` (Betreff: ${betreff})` : ''}:\n\n${antwort.slice(0, MAX_ZITAT)}` : 'Der Wortlaut der Antwort ist hier nicht verfügbar (kein Lesezugriff auf das Postfach). Bitte im Dashboard bzw. in Gmail nachsehen.',
  ].join('\n');
  return { betreff: `Weiterleitung: Antwort von ${lead.firma}`, text };
}

/**
 * Legt (höchstens einmal je Lead) einen Weiterleitungs-Entwurf an, wenn die Antwort im Vertretungszeitraum eintrifft.
 * Der Wortlaut kommt aus dem Thread, wenn das Postfach lesbar ist; Fehler dabei führen nur zu einem Entwurf ohne Wortlaut.
 * Wirft nie. Liefert die ID des Entwurfs oder null.
 */
export async function erstelleVertretungsEntwurf(leadId: number, jetzt: Date = new Date(), lader?: ThreadLader): Promise<number | null> {
  try {
    const k = vertretungKonfig();
    if (!imVertretungszeitraum(k, jetzt)) return null;
    const db = getDb();
    const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead) return null;
    if (db.select({ id: schema.vertretungsEntwuerfe.id }).from(schema.vertretungsEntwuerfe).where(eq(schema.vertretungsEntwuerfe.leadId, leadId)).get()) return null;
    const kampagne = db.select({ name: schema.campaigns.name }).from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get()?.name ?? '';

    let antwort: string | null = null;
    let betreff = '';
    try {
      const t = leadThreads(lead);
      const threadId = t.threads[t.start];
      if (t.postfach && t.lesezugriff && threadId) {
        const nachrichten = await ladeThread(t.postfach, threadId, { lader, frisch: true, jetzt: jetzt.getTime() });
        const m = letzteFremde(nachrichten);
        antwort = m?.text.trim() ?? null;
        betreff = m?.betreff ?? '';
      }
    } catch {
      // Ohne Wortlaut weitermachen
    }
    const kategorie = klassifiziereVertretung(betreff, antwort ?? '');
    const e = baueEntwurf(lead, kampagne, kategorie, betreff, antwort, getEnv().APP_URL, k);
    const an = (kategorie === 'technik' ? k.technik : k.firma).join(', ');
    const res = db.insert(schema.vertretungsEntwuerfe).values({ leadId, kategorie, an, betreff: e.betreff, text: e.text }).onConflictDoNothing().returning({ id: schema.vertretungsEntwuerfe.id }).get();
    return res?.id ?? null;
  } catch {
    return null;
  }
}

/** mailto:-Link, der den Entwurf im Mailprogramm öffnet */
export function mailtoLink(e: { an: string; betreff: string; text: string }): string {
  return `mailto:${e.an.split(/,\s*/).join(',')}?subject=${encodeURIComponent(e.betreff)}&body=${encodeURIComponent(e.text)}`;
}
