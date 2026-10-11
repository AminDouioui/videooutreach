import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { kannThreadLesen, ladeAbsender, postfachFuerLead } from './absender';
import { fehlerText, ladeThread, leadThreads, UniboxFehler } from './antworten';
import { getDb, schema } from './db';
import type { ThreadLader } from './gmail';
import { anthropicClient, entwerfeAntwort, kiAktiv, KiFehler, kiFehlerAus, MAX_EINORDNUNG_ZEICHEN, ordneAntwortEin, type Einordnung, type KiClient } from './ki';
import type { KiKategorie } from './ki-kategorien';
import type { LeadStatus } from './lead-status';
import { setzeLeadStatus } from './lead-status-db';
import type { ThreadNachricht } from './mail-parse';
import { merkeAbwesenheit } from './send';
import { kiAutoStatus } from './settings';
import { unsubscribeBySlug } from './suppression';

// Einordnung von Antworten mit KI: letzte fremde Nachricht lesen, klassifizieren, speichern (leads.kiEinordnung) und je
// nach Einstellung `ki_auto_status` nur vorschlagen oder automatisch anwenden. Fehler der KI dürfen den Versand und die
// Antwort-Erkennung nie blockieren: die Warteschlange fängt alles ab und versucht es höchstens 3x erneut.

export type KiOptionen = { ki?: KiClient; lader?: ThreadLader; jetzt?: Date };
type Lead = typeof schema.leads.$inferSelect;

/** Ab dieser Konfidenz wird im Modus „automatisch“ angewendet */
export const KI_SCHWELLE = 0.8;
export const KI_MAX_VERSUCHE = 3;
/** Wartezeit vor dem n-ten Wiederholversuch: n * 10 Minuten */
const WIEDERHOLUNG_MS = 10 * 60_000;
/** Nur Antworten der letzten Tage werden automatisch eingeordnet (kein Nachholen von Altbestand) */
const NEUE_ANTWORT_MS = 14 * 24 * 3600_000;

/** Kategorien, die direkt einem Lead-Status entsprechen */
const STATUS_KATEGORIE: Partial<Record<KiKategorie, LeadStatus>> = {
  interessiert: 'interessiert',
  spaeter: 'spaeter',
  nicht_interessiert: 'nicht_interessiert',
  falscher_ansprechpartner: 'falscher_ansprechpartner',
};

function ladeLead(id: number): Lead | undefined {
  return getDb().select().from(schema.leads).where(eq(schema.leads.id, id)).get();
}

/** Text der letzten Nachricht, die nicht von uns stammt (bereinigt, ohne Zitat). null = keine vorhanden. */
export function letzteFremdeNachricht(nachrichten: ThreadNachricht[]): string | null {
  for (let i = nachrichten.length - 1; i >= 0; i--) {
    const n = nachrichten[i];
    if (!n.eigene && n.text.trim()) return n.text.trim().slice(0, MAX_EINORDNUNG_ZEICHEN * 2);
  }
  return null;
}

// ---------------------------------------------------------------- Anwenden

/**
 * Wendet eine Einordnung auf den Lead an:
 * - interessiert / später / nicht interessiert / falscher Ansprechpartner → Lead-Status
 * - abmeldung → wie ein Klick auf den Abmeldelink (Sperrliste, offene Mails übersprungen)
 * - abwesenheit → wie die Abwesenheitserkennung: die Antwort zählt nicht, der Flow läuft weiter, Follow-ups warten
 * - sonstiges → nichts
 * Liefert, ob etwas geändert wurde. `ueberschreibeStatus` = manuell bestätigt (sonst nur bei Lead-Status „offen“).
 */
export function wendeEinordnungAn(leadId: number, kategorie: KiKategorie, jetzt: Date, ueberschreibeStatus = false): boolean {
  const lead = ladeLead(leadId);
  if (!lead) return false;
  const status = STATUS_KATEGORIE[kategorie];
  if (status) {
    if (!ueberschreibeStatus && lead.leadStatus !== 'offen') return false;
    if (lead.leadStatus === status) return false;
    return setzeLeadStatus(leadId, status, jetzt);
  }
  if (kategorie === 'abmeldung') {
    if (lead.unsubscribed) return false;
    return unsubscribeBySlug(lead.slug);
  }
  if (kategorie === 'abwesenheit') {
    if (lead.abwesendAt && lead.flowStopp !== 'beantwortet') return false;
    const db = getDb();
    if (lead.flowStopp === 'beantwortet') {
      // Fälschlich als Antwort erkannt: Flow wieder freigeben (Abwesenheit stoppt ihn nie)
      db.update(schema.leads).set({ flowStopp: null, flowStoppAt: null, antwortAt: null, antwortThreadId: null, antwortGelesen: true }).where(eq(schema.leads.id, leadId)).run();
    }
    merkeAbwesenheit(lead, jetzt);
    return true;
  }
  return false;
}

/** Soll im Modus „automatisch“ angewendet werden? (Konfidenz-Schwelle) */
export function automatischAnwenden(e: Pick<Einordnung, 'konfidenz' | 'kategorie'>): boolean {
  return e.kategorie !== 'sonstiges' && e.konfidenz >= KI_SCHWELLE;
}

function speichere(leadId: number, e: Einordnung, jetzt: Date, angewendet: boolean): NonNullable<Lead['kiEinordnung']> {
  const wert = { kategorie: e.kategorie, konfidenz: e.konfidenz, begruendung: e.begruendung, at: jetzt.getTime(), angewendet };
  getDb().update(schema.leads).set({ kiEinordnung: wert }).where(eq(schema.leads.id, leadId)).run();
  return wert;
}

// ---------------------------------------------------------------- Einordnen

export type LeadKiErgebnis<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/** Lädt den Verlauf des Leads (Antwort-Thread) als bereinigte Nachrichten. Wirft UniboxFehler/GmailSendError. */
async function ladeVerlauf(lead: Lead, opt: KiOptionen): Promise<ThreadNachricht[]> {
  const t = leadThreads(lead);
  if (!t.postfach) throw new UniboxFehler('Diesem Lead ist kein Postfach zugeordnet.');
  if (!t.lesezugriff) throw new UniboxFehler(`Für ${t.postfach.email} fehlt der Lesezugriff (Einstellungen → Postfächer „Lesezugriff erteilen“).`);
  const threadId = t.threads[t.start];
  if (!threadId) throw new UniboxFehler('Zu diesem Lead gibt es noch keinen Mail-Verlauf.');
  return ladeThread(t.postfach, threadId, { lader: opt.lader, frisch: true, jetzt: opt.jetzt?.getTime() });
}

function fehlerAus(e: unknown): { status: number; error: string } {
  if (e instanceof KiFehler) return { status: e.art === 'anfrage' || e.art === 'antwort' ? 422 : 502, error: e.message };
  return { status: e instanceof UniboxFehler ? e.status : 502, error: fehlerText(e) };
}

/**
 * Ordnet die letzte fremde Nachricht des Leads ein und speichert das Ergebnis. Modus „automatisch“ (Einstellung) wendet
 * es bei Konfidenz ≥ 0,8 an; sonst bleibt es ein Vorschlag. `manuell` (Button): wendet nur im Modus „automatisch“ an.
 */
export async function ordneLeadEin(leadId: number, opt: KiOptionen = {}): Promise<LeadKiErgebnis<{ einordnung: NonNullable<Lead['kiEinordnung']>; angewendet: boolean }>> {
  const lead = ladeLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
  const jetzt = opt.jetzt ?? new Date();
  try {
    const text = letzteFremdeNachricht(await ladeVerlauf(lead, opt));
    if (!text) throw new UniboxFehler('Im Thread gibt es keine Nachricht des Leads, die eingeordnet werden könnte.');
    const e = await ordneAntwortEin(text, opt.ki ?? anthropicClient);
    const angewendet = kiAutoStatus() === 'automatisch' && automatischAnwenden(e) && wendeEinordnungAn(leadId, e.kategorie, jetzt);
    return { ok: true, einordnung: speichere(leadId, e, jetzt, angewendet), angewendet };
  } catch (err) {
    return { ok: false, ...fehlerAus(err) };
  }
}

/** Gespeicherte Einordnung anwenden (Button „Vorschlag übernehmen“, ohne Konfidenz-Schwelle, überschreibt den Status). */
export function uebernimmEinordnung(leadId: number, jetzt: Date = new Date()): LeadKiErgebnis<{ angewendet: boolean }> {
  const lead = ladeLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
  if (!lead.kiEinordnung) return { ok: false, status: 409, error: 'Es gibt noch keine KI-Einordnung für diesen Lead.' };
  const kategorie = lead.kiEinordnung.kategorie as KiKategorie;
  const angewendet = wendeEinordnungAn(leadId, kategorie, jetzt, true);
  getDb().update(schema.leads).set({ kiEinordnung: { ...lead.kiEinordnung, angewendet: angewendet || !!lead.kiEinordnung.angewendet } }).where(eq(schema.leads.id, leadId)).run();
  return { ok: true, angewendet };
}

// ---------------------------------------------------------------- Entwurf

/** Entwurf einer Antwort auf Basis des Verlaufs und des Kampagnen-Terminlinks (nichts wird gesendet oder gespeichert). */
export async function entwerfeLeadAntwort(leadId: number, opt: KiOptionen = {}): Promise<LeadKiErgebnis<{ text: string }>> {
  const lead = ladeLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
  try {
    const verlauf = await ladeVerlauf(lead, opt);
    const kampagne = getDb().select({ cta: schema.campaigns.ctaUrl }).from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
    const postfach = postfachFuerLead(lead);
    const text = await entwerfeAntwort({ verlauf, ctaUrl: kampagne?.cta ?? '', absenderName: postfach?.name ?? undefined }, opt.ki ?? anthropicClient);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, ...fehlerAus(err) };
  }
}

// ---------------------------------------------------------------- Warteschlange (Worker)

/**
 * Ordnet höchstens eine neue Antwort pro Aufruf ein (aus dem Versand-Durchlauf). Voraussetzungen: Schlüssel (oder
 * injizierter Client), Einstellung ≠ „aus“, Postfach mit Lesezugriff, Antwort der letzten 14 Tage ohne Einordnung.
 * Fehler werden abgefangen und gezählt (höchstens 3 Versuche, mit wachsender Wartezeit) – sie blockieren nichts.
 * Liefert die Lead-ID, wenn ein Versuch stattfand.
 */
export async function verarbeiteKiWarteschlange(opt: KiOptionen & { log?: (msg: string) => void } = {}): Promise<number | null> {
  try {
    if (!opt.ki && !kiAktiv()) return null;
    if (kiAutoStatus() === 'aus') return null;
    const jetzt = opt.jetzt ?? new Date();
    const lesbar = ladeAbsender().filter(kannThreadLesen).map((a) => a.id);
    if (lesbar.length === 0) return null;
    const lead = getDb()
      .select()
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.flowStopp, 'beantwortet'),
          isNull(schema.leads.kiEinordnung),
          lt(schema.leads.kiVersuche, KI_MAX_VERSUCHE),
          sql`${schema.leads.antwortAt} > ${jetzt.getTime() - NEUE_ANTWORT_MS}`,
          or(isNull(schema.leads.kiVersuchAt), sql`${schema.leads.kiVersuchAt} + ${schema.leads.kiVersuche} * ${WIEDERHOLUNG_MS} <= ${jetzt.getTime()}`),
        ),
      )
      .orderBy(sql`${schema.leads.antwortAt}`)
      .all()
      .find((l) => {
        const p = postfachFuerLead(l);
        return !!p && lesbar.includes(p.id);
      });
    if (!lead) return null;
    const res = await ordneLeadEin(lead.id, opt);
    if (!res.ok) {
      getDb().update(schema.leads).set({ kiVersuche: lead.kiVersuche + 1, kiVersuchAt: jetzt }).where(eq(schema.leads.id, lead.id)).run();
      // Nur die Art des Fehlers loggen, nie Inhalte
      opt.log?.(`KI-Einordnung Lead ${lead.id} fehlgeschlagen (Versuch ${lead.kiVersuche + 1}/${KI_MAX_VERSUCHE}): ${res.error}`);
    }
    return lead.id;
  } catch (e) {
    // Darf den Versand nie stören
    opt.log?.(`KI-Warteschlange: ${kiFehlerAus(e).message}`);
    return null;
  }
}
