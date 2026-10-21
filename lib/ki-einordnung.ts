import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { kannThreadLesen, ladeAbsender, postfachFuerLead } from './absender';
import { fehlerText, ladeThread, leadThreads, UniboxFehler } from './antworten';
import { getDb, schema } from './db';
import type { ThreadLader } from './gmail';
import { anthropicClient, entwerfeAntwortGeprueft, klassifizierungVerfuegbar, leseRueckkehr, leseVerweis, leseWiedervorlage, ordneEinwandEin, schreibhilfeVerfuegbar, KiFehler, KLASSIFIZIERUNG_NICHT_AKTIV, kiFehlerAus, MAX_EINORDNUNG_ZEICHEN, ordneAntwortEin, type Einordnung, type KiClient } from './ki';
import { kontextFuerPrompt, ladeLeadKontext, type BrainFetch } from './brain';
import { ordneAntwortMitJev, type JevFetch } from './ki-jev';
import { openaiClient } from './ki-openai';
import type { KiKategorie } from './ki-kategorien';
import type { LeadStatus } from './lead-status';
import { setzeLeadStatus } from './lead-status-db';
import type { ThreadNachricht } from './mail-parse';
import { merkeAbwesenheit } from './send';
import { konterFuer } from './einwaende';
import { legeVerweisLeadAn } from './verweis-db';
import { webhookAusloesen } from './webhooks';
import { einwandKonter, kiAutoStatus, kiEntwurfAnbieter, kiKlassifizierer, schreibregelnAktiv, type KiKlassifizierer } from './settings';
import type { SchreibVerstoss } from './schreibregeln';
import { unsubscribeBySlug } from './suppression';
import { startOfDayBerlinMs, todayBerlin } from './time';

// Einordnung von Antworten mit KI: letzte fremde Nachricht lesen, klassifizieren, speichern (leads.kiEinordnung) und je
// nach Einstellung `ki_auto_status` nur vorschlagen oder automatisch anwenden. Fehler der KI dürfen den Versand und die
// Antwort-Erkennung nie blockieren: die Warteschlange fängt alles ab und versucht es höchstens 3x erneut.

// `ki` ersetzt den Anthropic-Client, `jevFetch`/`openaiFetch` das fetch für Jev bzw. OpenAI (Tests); wer einen davon übergibt, nutzt diesen Klassifizierer.
// `schreibregeln` überschreibt die Einstellung `schreibregeln_aktiv`, `brainFetch` ersetzt das fetch zum Brain (Tests).
export type KiOptionen = { ki?: KiClient; jevFetch?: JevFetch; openaiFetch?: JevFetch; lader?: ThreadLader; jetzt?: Date; schreibregeln?: boolean; brainFetch?: BrainFetch };
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

/** Letzte fremde Nachricht mit Betreff (für Jev, das den Betreff mitbekommt) */
function letzteFremdeMitBetreff(nachrichten: ThreadNachricht[]): { text: string; betreff: string } | null {
  const text = letzteFremdeNachricht(nachrichten);
  if (!text) return null;
  const n = [...nachrichten].reverse().find((x) => !x.eigene && x.text.trim());
  return { text, betreff: n?.betreff ?? '' };
}

/** Welcher Klassifizierer gilt? Injizierter Client/fetch gewinnt, sonst Einstellung + vorhandene Schlüssel. null = keiner. */
export function waehleKlassifizierer(opt: KiOptionen = {}): KiKlassifizierer | null {
  if (opt.ki) return 'anthropic';
  if (opt.jevFetch) return 'jev';
  return kiKlassifizierer();
}

/** Client für Texte/Entwürfe: injizierter Client/fetch gewinnt, sonst Einstellung + vorhandene Schlüssel (OpenAI oder Anthropic). */
export function schreibClient(opt: Pick<KiOptionen, 'ki' | 'openaiFetch'> = {}): KiClient {
  if (opt.ki) return opt.ki;
  if (opt.openaiFetch) return openaiClient(opt.openaiFetch);
  return kiEntwurfAnbieter() === 'openai' ? openaiClient() : anthropicClient;
}

/** Ordnet mit dem gewählten Klassifizierer ein; liefert zusätzlich, womit. */
async function klassifiziere(m: { text: string; betreff: string }, opt: KiOptionen): Promise<{ e: Einordnung; modell: KiKlassifizierer }> {
  const modell = waehleKlassifizierer(opt);
  if (!modell) throw new KiFehler(KLASSIFIZIERUNG_NICHT_AKTIV, 'deaktiviert');
  const e = modell === 'jev' ? await ordneAntwortMitJev(m.text, m.betreff, opt.jevFetch) : await ordneAntwortEin(m.text, opt.ki ?? anthropicClient);
  return { e, modell };
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

function speichere(leadId: number, e: Einordnung, jetzt: Date, angewendet: boolean, modell: KiKlassifizierer): NonNullable<Lead['kiEinordnung']> {
  const wert = { kategorie: e.kategorie, konfidenz: e.konfidenz, begruendung: e.begruendung, at: jetzt.getTime(), angewendet, modell };
  getDb().update(schema.leads).set({ kiEinordnung: wert }).where(eq(schema.leads.id, leadId)).run();
  return wert;
}

// ---------------------------------------------------------------- Einordnen

export type LeadKiErgebnis<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/** Lädt den Verlauf des Leads (Antwort-Thread) als bereinigte Nachrichten. Wirft UniboxFehler/GmailSendError. */
async function ladeVerlauf(lead: Lead, opt: KiOptionen, frisch = true): Promise<ThreadNachricht[]> {
  const t = leadThreads(lead);
  if (!t.postfach) throw new UniboxFehler('Diesem Lead ist kein Postfach zugeordnet.');
  if (!t.lesezugriff) throw new UniboxFehler(`Für ${t.postfach.email} fehlt der Lesezugriff (Einstellungen → Postfächer „Lesezugriff erteilen“).`);
  const threadId = t.threads[t.start];
  if (!threadId) throw new UniboxFehler('Zu diesem Lead gibt es noch keinen Mail-Verlauf.');
  return ladeThread(t.postfach, threadId, { lader: opt.lader, frisch, jetzt: opt.jetzt?.getTime() });
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
    const m = letzteFremdeMitBetreff(await ladeVerlauf(lead, opt));
    if (!m) throw new UniboxFehler('Im Thread gibt es keine Nachricht des Leads, die eingeordnet werden könnte.');
    const { e, modell } = await klassifiziere(m, opt);
    const angewendet = kiAutoStatus() === 'automatisch' && automatischAnwenden(e) && wendeEinordnungAn(leadId, e.kategorie, jetzt);
    return { ok: true, einordnung: speichere(leadId, e, jetzt, angewendet, modell), angewendet };
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

/** Woher der Entwurf sein Hintergrundwissen hatte: genutzt, Brain nicht eingerichtet, im Brain nichts zum Lead, oder Fehler (Meldung dabei) */
export type EntwurfBrain = { status: 'genutzt' | 'nicht_verbunden' | 'nichts_gefunden' | 'fehler'; meldung?: string };

/** Entwurf einer Antwort auf Basis des Verlaufs, des Kampagnen-Terminlinks und (wenn das Brain verbunden ist) des Lead-Kontexts. Nichts wird gesendet oder gespeichert. */
export async function entwerfeLeadAntwort(leadId: number, opt: KiOptionen = {}, extra: { anlass?: string } = {}): Promise<LeadKiErgebnis<{ text: string; verstoesse: SchreibVerstoss[]; brain: EntwurfBrain }>> {
  const lead = ladeLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
  try {
    const verlauf = await ladeVerlauf(lead, opt);
    const kampagne = getDb().select({ cta: schema.campaigns.ctaUrl }).from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
    const postfach = postfachFuerLead(lead);
    // Brain-Kontext: nie blockierend, Fehler werden nur als Hinweis gemeldet
    const k = await ladeLeadKontext({ id: lead.id, email: lead.email, firma: lead.firma, website: lead.website }, { fetch: opt.brainFetch });
    const kontext = k.status === 'ok' ? kontextFuerPrompt(k.daten) : '';
    const brain: EntwurfBrain = k.status === 'nicht_konfiguriert' ? { status: 'nicht_verbunden' } : k.status === 'fehler' ? { status: 'fehler', meldung: k.meldung } : kontext ? { status: 'genutzt' } : { status: 'nichts_gefunden' };
    const res = await entwerfeAntwortGeprueft({ verlauf, ctaUrl: kampagne?.cta ?? '', absenderName: postfach?.name ?? undefined, brainKontext: kontext || undefined, konter: konterFuer(lead.kiEinwand, einwandKonter()) ?? undefined, anlass: extra.anlass }, schreibClient(opt), { schreibregeln: opt.schreibregeln ?? schreibregelnAktiv() });
    return { ok: true, text: res.text, verstoesse: res.verstoesse, brain };
  } catch (err) {
    return { ok: false, ...fehlerAus(err) };
  }
}

/** Nach diesen Kategorien liegt automatisch ein Antwort-Entwurf bereit (bei Absage, Abmeldung und Abwesenheit nicht) */
const ENTWURF_KATEGORIEN: ReadonlySet<string> = new Set(['interessiert', 'spaeter', 'falscher_ansprechpartner', 'sonstiges']);

/** Legt einen Antwort-Entwurf an (leads.kiEntwurf), ohne zu senden. Fehler und fehlender Schlüssel bleiben still: der Button „Entwurf mit KI“ funktioniert weiter. */
async function erstelleAutoEntwurf(leadId: number, opt: KiOptionen): Promise<boolean> {
  if (!opt.ki && !opt.openaiFetch && !schreibhilfeVerfuegbar()) return false;
  if (ladeLead(leadId)?.kiEntwurf) return false;
  const res = await entwerfeLeadAntwort(leadId, opt);
  if (!res.ok) return false;
  getDb().update(schema.leads).set({ kiEntwurf: { text: res.text, at: (opt.jetzt ?? new Date()).getTime(), verstoesse: res.verstoesse.length } }).where(eq(schema.leads.id, leadId)).run();
  return true;
}

// ---------------------------------------------------------------- Abwesenheit: Rückkehrdatum

/** Weiter als das in der Zukunft gilt ein erkanntes Rückkehrdatum als Fehlinterpretation */
export const ABWESENHEIT_MAX_TAGE = 180;
const TAG_MS = 24 * 3600_000;

/** Erster Moment (Berlin) des Rückkehrtags, wenn das Datum in der Zukunft und im Rahmen liegt, sonst null. */
export function rueckkehrZeitpunkt(datum: string | null, jetzt: Date, maxTage = ABWESENHEIT_MAX_TAGE): Date | null {
  if (!datum) return null;
  const [y, m, d] = datum.split('-').map(Number);
  const mittag = new Date(Date.UTC(y, m - 1, d, 12));
  if (Number.isNaN(mittag.getTime()) || mittag.getUTCDate() !== d) return null;
  const bis = new Date(startOfDayBerlinMs(mittag));
  return bis.getTime() > jetzt.getTime() && bis.getTime() <= jetzt.getTime() + maxTage * TAG_MS ? bis : null;
}

/**
 * Liest das Rückkehrdatum aus der Abwesenheitsnotiz des Leads und setzt `abwesendBis` darauf: die Follow-ups warten dann
 * genau bis zu diesem Tag (statt pauschal N Tage). Ohne erkennbares Datum bleibt die Wartezeit der Kampagne.
 */
export async function leseAbwesenheitsRueckkehr(leadId: number, opt: KiOptionen = {}): Promise<LeadKiErgebnis<{ bis: Date | null; vertretung: string }>> {
  const lead = ladeLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
  const jetzt = opt.jetzt ?? new Date();
  try {
    const text = letzteFremdeNachricht(await ladeVerlauf(lead, opt));
    if (!text) throw new UniboxFehler('Im Thread gibt es keine Abwesenheitsnotiz, die gelesen werden könnte.');
    const r = await leseRueckkehr(text, todayBerlin(jetzt), schreibClient(opt));
    const bis = rueckkehrZeitpunkt(r.datum, jetzt);
    getDb()
      .update(schema.leads)
      .set({ abwesendKiAt: jetzt, ...(bis ? { abwesendBis: bis } : {}) })
      .where(eq(schema.leads.id, leadId))
      .run();
    return { ok: true, bis, vertretung: r.vertretung };
  } catch (err) {
    return { ok: false, ...fehlerAus(err) };
  }
}

/**
 * Wertet höchstens eine neue Abwesenheitsnotiz pro Aufruf aus (Worker). Voraussetzungen: Schlüssel für Texte (OpenAI oder
 * Anthropic), Einstellung ≠ „aus“, Postfach mit Lesezugriff, Notiz der letzten 14 Tage, Follow-ups warten noch
 * (`abwesendBis` in der Zukunft; bei Kampagnen ohne Verschieben bleibt alles wie es ist). Höchstens 3 Versuche je Lead.
 */
export async function verarbeiteAbwesenheitsWarteschlange(opt: KiOptionen & { log?: (msg: string) => void } = {}): Promise<number | null> {
  try {
    if (!opt.ki && !opt.openaiFetch && !schreibhilfeVerfuegbar()) return null;
    if (kiAutoStatus() === 'aus') return null;
    const jetzt = opt.jetzt ?? new Date();
    const lesbar = ladeAbsender().filter(kannThreadLesen).map((a) => a.id);
    if (lesbar.length === 0) return null;
    const lead = getDb()
      .select()
      .from(schema.leads)
      .where(
        and(
          isNull(schema.leads.flowStopp),
          isNull(schema.leads.abwesendKiAt),
          lt(schema.leads.abwesendKiVersuche, KI_MAX_VERSUCHE),
          sql`${schema.leads.abwesendAt} > ${jetzt.getTime() - NEUE_ANTWORT_MS}`,
          sql`${schema.leads.abwesendBis} > ${jetzt.getTime()}`,
          or(isNull(schema.leads.kiVersuchAt), sql`${schema.leads.kiVersuchAt} + ${schema.leads.abwesendKiVersuche} * ${WIEDERHOLUNG_MS} <= ${jetzt.getTime()}`),
        ),
      )
      .orderBy(sql`${schema.leads.abwesendAt}`)
      .all()
      .find((l) => {
        const p = postfachFuerLead(l);
        return !!p && lesbar.includes(p.id);
      });
    if (!lead) return null;
    const res = await leseAbwesenheitsRueckkehr(lead.id, opt);
    if (!res.ok) {
      getDb().update(schema.leads).set({ abwesendKiVersuche: lead.abwesendKiVersuche + 1, kiVersuchAt: jetzt }).where(eq(schema.leads.id, lead.id)).run();
      opt.log?.(`Rückkehrdatum Lead ${lead.id} nicht gelesen (Versuch ${lead.abwesendKiVersuche + 1}/${KI_MAX_VERSUCHE}): ${res.error}`);
    }
    return lead.id;
  } catch (e) {
    opt.log?.(`Abwesenheits-Warteschlange: ${kiFehlerAus(e).message}`);
    return null;
  }
}

// ---------------------------------------------------------------- Einwand, Wiedervorlage, Verweis

/** Kategorien, bei denen der Einwand gelesen wird (bei Interesse meist „kein Einwand“) */
const EINWAND_KATEGORIEN: ReadonlySet<string> = new Set(['interessiert', 'spaeter', 'nicht_interessiert', 'falscher_ansprechpartner', 'sonstiges']);
/** Eine Wiedervorlage weiter als ein Jahr in der Zukunft gilt als Fehlinterpretation */
const WIEDERVORLAGE_MAX_TAGE = 400;
/** Uhrzeit (Berlin) der Wiedervorlage am gewählten Tag */
const WIEDERVORLAGE_STUNDE = 8;

/**
 * Liest nach der Einordnung zusätzliche Angaben aus der Antwort: den Einwand (für Konter und Auswertung), bei „später“ das
 * Datum der Wiedervorlage und bei „falscher Ansprechpartner“ den Verweis (im Modus „automatisch“ bei hoher Sicherheit gleich
 * als neuer Lead). Jeder Schritt ist für sich fehlertolerant: ein Fehler lässt die Einordnung gültig und blockiert nichts.
 */
export async function reichereAntwortAn(leadId: number, e: Pick<Einordnung, 'kategorie' | 'konfidenz'>, opt: KiOptionen = {}): Promise<string[]> {
  const notizen: string[] = [];
  if (!opt.ki && !opt.openaiFetch && !schreibhilfeVerfuegbar()) return notizen;
  const lead = ladeLead(leadId);
  if (!lead) return notizen;
  const jetzt = opt.jetzt ?? new Date();
  let text: string | null = null;
  try {
    text = letzteFremdeNachricht(await ladeVerlauf(lead, opt, false));
  } catch {
    return notizen;
  }
  if (!text) return notizen;
  const client = schreibClient(opt);
  const db = getDb();
  if (EINWAND_KATEGORIEN.has(e.kategorie)) {
    try {
      const einwand = await ordneEinwandEin(text, client);
      db.update(schema.leads).set({ kiEinwand: einwand }).where(eq(schema.leads.id, leadId)).run();
      notizen.push(`Einwand ${einwand}`);
    } catch {
      /* bleibt ohne Einwand */
    }
  }
  if (e.kategorie === 'spaeter') {
    try {
      const datum = await leseWiedervorlage(text, todayBerlin(jetzt), client);
      const tag = rueckkehrZeitpunkt(datum, jetzt, WIEDERVORLAGE_MAX_TAGE);
      if (tag) {
        db.update(schema.leads).set({ wiedervorlageAt: new Date(tag.getTime() + WIEDERVORLAGE_STUNDE * 3600_000), wiedervorlageErledigtAt: null }).where(eq(schema.leads.id, leadId)).run();
        notizen.push(`Wiedervorlage ${datum}`);
      }
    } catch {
      /* ohne Datum keine Wiedervorlage */
    }
  }
  if (e.kategorie === 'falscher_ansprechpartner') {
    try {
      const v = await leseVerweis(text, client);
      if (v.name || v.email) {
        db.update(schema.leads).set({ kiVerweis: { name: v.name, email: v.email, position: v.position } }).where(eq(schema.leads.id, leadId)).run();
        notizen.push('Verweis erkannt');
        if (v.email && kiAutoStatus() === 'automatisch' && e.konfidenz >= KI_SCHWELLE) {
          const r = legeVerweisLeadAn(leadId, jetzt);
          notizen.push(r.ok ? `Lead ${r.neuerLeadId} angelegt` : `Lead nicht angelegt: ${r.error}`);
        }
      }
    } catch {
      /* ohne Verweis nichts anzulegen */
    }
  }
  return notizen;
}

/**
 * Löst fällige Wiedervorlagen aus (höchstens eine je Aufruf): der Lead hatte um späteren Kontakt gebeten, das Datum ist da.
 * Die Antwort wird wieder ungelesen, der Webhook `wiedervorlage` geht raus und, soweit möglich, liegt ein Entwurf bereit.
 * Es wird nie automatisch gesendet: wer um Zeit gebeten hat, bekommt eine persönlich geprüfte Nachricht.
 */
export async function verarbeiteWiedervorlagen(opt: KiOptionen & { log?: (msg: string) => void } = {}): Promise<number | null> {
  try {
    const jetzt = opt.jetzt ?? new Date();
    const lead = getDb()
      .select()
      .from(schema.leads)
      .where(and(isNull(schema.leads.wiedervorlageErledigtAt), sql`${schema.leads.wiedervorlageAt} <= ${jetzt.getTime()}`, eq(schema.leads.unsubscribed, false)))
      .orderBy(sql`${schema.leads.wiedervorlageAt}`)
      .get();
    if (!lead) return null;
    const db = getDb();
    // Abgemeldet, gewonnen oder nicht mehr interessiert: nichts mehr zu tun
    const erledigt = ['nicht_interessiert', 'gewonnen', 'verloren', 'termin_gebucht'].includes(lead.leadStatus);
    db.update(schema.leads).set({ wiedervorlageErledigtAt: jetzt }).where(eq(schema.leads.id, lead.id)).run();
    if (erledigt) return lead.id;
    if (opt.ki || opt.openaiFetch || schreibhilfeVerfuegbar()) {
      const res = await entwerfeLeadAntwort(lead.id, opt, { anlass: 'Wiedervorlage: Der Lead hat zuvor darum gebeten, sich später wieder zu melden. Nimm freundlich Bezug darauf und knüpfe an den bisherigen Verlauf an.' });
      if (res.ok) db.update(schema.leads).set({ kiEntwurf: { text: res.text, at: jetzt.getTime(), verstoesse: res.verstoesse.length } }).where(eq(schema.leads.id, lead.id)).run();
      else opt.log?.(`Wiedervorlage Lead ${lead.id}: kein Entwurf (${res.error})`);
    }
    db.update(schema.leads).set({ antwortGelesen: false }).where(eq(schema.leads.id, lead.id)).run();
    webhookAusloesen('wiedervorlage', { leadId: lead.id, geplantFuer: lead.wiedervorlageAt ? lead.wiedervorlageAt.toISOString() : null }, jetzt);
    return lead.id;
  } catch (e) {
    opt.log?.(`Wiedervorlage: ${kiFehlerAus(e).message}`);
    return null;
  }
}

// ---------------------------------------------------------------- Warteschlange (Worker)

/**
 * Ordnet höchstens eine neue Antwort pro Aufruf ein (aus dem Versand-Durchlauf). Voraussetzungen: Schlüssel (Anthropic oder
 * OpenRouter/Jev, oder injizierter Client), Einstellung ≠ „aus“, Postfach mit Lesezugriff, Antwort der letzten 14 Tage ohne Einordnung.
 * Fehler werden abgefangen und gezählt (höchstens 3 Versuche, mit wachsender Wartezeit) – sie blockieren nichts.
 * Liefert die Lead-ID, wenn ein Versuch stattfand.
 */
export async function verarbeiteKiWarteschlange(opt: KiOptionen & { log?: (msg: string) => void } = {}): Promise<number | null> {
  try {
    if (!opt.ki && !opt.jevFetch && !klassifizierungVerfuegbar()) return null;
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
    } else {
      // Einwand, Wiedervorlage-Datum und Verweis lesen; danach (mit dem Konter zum Einwand) den Entwurf bereitlegen.
      // Jeder Schritt fängt seine Fehler selbst ab, die Einordnung bleibt in jedem Fall gültig.
      await reichereAntwortAn(lead.id, res.einordnung as Einordnung, opt).catch(() => []);
      if (ENTWURF_KATEGORIEN.has(res.einordnung.kategorie)) await erstelleAutoEntwurf(lead.id, opt).catch(() => false);
    }
    return lead.id;
  } catch (e) {
    // Darf den Versand nie stören
    opt.log?.(`KI-Warteschlange: ${kiFehlerAus(e).message}`);
    return null;
  }
}
