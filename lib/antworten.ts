import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { absenderSignatur, kannThreadLesen, postfachFuerLead, postfachVerbunden, type Absender } from './absender';
import { istBounceFehler } from './bounce-schutz';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { threadsDesLeads } from './followup-varianten-db';
import { GmailSendError, type GmailSender, type ThreadLader } from './gmail';
import { treiberFuer } from './postfach-treiber';
import { antwortBetreff, buildAntwortMail, buildMime, neueMessageId, oneClickUrl } from './mail';
import { extrahiereAdresse, fuerAnzeige, parseThread, type NachrichtMitKopf, type ThreadNachricht } from './mail-parse';
import { merkePostfachFehler, senderInfo } from './send';
import { ANTWORT_STEP } from './versand-schritt';

// Unibox: Threads lesen und aus der App antworten. Gmail-Aufrufe sind austauschbar (Tests); Fehler kommen auf Deutsch.

/** Fehler mit verständlicher deutscher Meldung und HTTP-nahem Status */
export class UniboxFehler extends Error {
  constructor(
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- Fehlertexte

/** Verständliche deutsche Meldung für beliebige Fehler beim Lesen/Senden. */
export function fehlerText(e: unknown): string {
  if (e instanceof UniboxFehler) return e.message;
  if (e instanceof GmailSendError) {
    const m = e.info.meldung;
    const l = m.toLowerCase();
    if (e.info.art === 'auth') {
      if (l.includes('invalid_grant')) return 'Der Zugriff auf das Postfach wurde widerrufen oder ist abgelaufen. Bitte unter Einstellungen → Postfächer „Neu verbinden“ (bei Bedarf mit Lesezugriff).';
      if (l.includes('berechtigung fehlt') || l.includes('insufficient')) return 'Es fehlt die Berechtigung zum Lesen. Bitte unter Einstellungen → Postfächer „Lesezugriff erteilen“.';
      return m;
    }
    if (l.includes('not found') || l.includes('404')) return 'Der Thread wurde im Postfach nicht gefunden (gelöscht oder zu einem anderen Konto gehörig).';
    return m;
  }
  const m = e instanceof Error ? e.message : String(e);
  return /^GOOGLE_CLIENT_ID/.test(m) ? 'Die Google-Zugangsdaten fehlen in der Server-Konfiguration (GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET, siehe docs/gmail-einrichtung.md).' : `Unerwarteter Fehler: ${m.slice(0, 300)}`;
}

// ---------------------------------------------------------------- Thread lesen (mit kurzem Cache)

const CACHE_MS = 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { bis: number; daten: NachrichtMitKopf[] }>();

/** Cache leeren (Tests, nach dem Senden). Ohne Angabe alles. */
export function leereThreadCache(absenderId?: number, threadId?: string): void {
  if (absenderId === undefined) return cache.clear();
  if (threadId) cache.delete(`${absenderId}:${threadId}`);
  else for (const k of cache.keys()) if (k.startsWith(`${absenderId}:`)) cache.delete(k);
}

export type LadeOptionen = { lader?: ThreadLader; /** Cache ignorieren */ frisch?: boolean; jetzt?: number };

/** Prüft, ob das Postfach Threads lesen darf; wirft sonst UniboxFehler mit Hinweis. */
function pruefeLesezugriff(absender: Pick<Absender, 'email' | 'refreshTokenEnc' | 'scopes' | 'typ' | 'zugangsdatenEnc'>): void {
  if (!postfachVerbunden(absender)) throw new UniboxFehler(`Das Postfach ${absender.email} ist nicht verbunden.`);
  if (!kannThreadLesen(absender)) throw new UniboxFehler(`Für ${absender.email} fehlt der Lesezugriff. Unter Einstellungen → Postfächer „Lesezugriff erteilen“.`);
}

/** Wie ladeThread, aber mit den Kopfzeilen, die zum Antworten nötig sind (Message-ID, References, Reply-To). */
export async function ladeThreadMitKopf(absender: Absender, threadId: string, opt: LadeOptionen = {}): Promise<NachrichtMitKopf[]> {
  pruefeLesezugriff(absender);
  const jetzt = opt.jetzt ?? Date.now();
  const key = `${absender.id}:${threadId}`;
  const treffer = cache.get(key);
  if (!opt.frisch && treffer && treffer.bis > jetzt) return treffer.daten;
  const roh = await (opt.lader ?? treiberFuer(absender).ladeThread)(threadId, absender);
  const daten = parseThread(roh, absender.email);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { bis: jetzt + CACHE_MS, daten });
  return daten;
}

/** Liest einen Thread (users.threads.get format=full) als Liste {von, an, datum, betreff, text, zitat, eigene}. 60 s im Speicher gepuffert. */
export async function ladeThread(absender: Absender, threadId: string, opt: LadeOptionen = {}): Promise<ThreadNachricht[]> {
  return (await ladeThreadMitKopf(absender, threadId, opt)).map(fuerAnzeige);
}

// ---------------------------------------------------------------- Lead → Threads

export type LeadThreads = {
  /** Postfach der Erstmail des Leads (null = keins zugeordnet) */
  postfach: Absender | null;
  threads: string[];
  /** Index des Antwort-Threads in `threads` */
  start: number;
  lesezugriff: boolean;
};

type LeadKurz = { id: number; absenderId: number | null; gmailThreadId: string | null; antwortThreadId: string | null };

/** Threads des Leads (Erstmail, Follow-ups mit neuem Thread, Antwort-Thread) und ob der Verlauf lesbar ist. */
export function leadThreads(lead: LeadKurz): LeadThreads {
  const postfach = postfachFuerLead(lead);
  const threads = threadsDesLeads(lead);
  if (lead.antwortThreadId && !threads.includes(lead.antwortThreadId)) threads.push(lead.antwortThreadId);
  const start = Math.max(0, lead.antwortThreadId ? threads.indexOf(lead.antwortThreadId) : 0);
  return { postfach, threads, start, lesezugriff: !!postfach && kannThreadLesen(postfach) };
}

function ladeLead(id: number) {
  return getDb().select().from(schema.leads).where(eq(schema.leads.id, id)).get();
}

export type ThreadAntwort = { ok: true; threadId: string; nachrichten: ThreadNachricht[] } | { ok: false; error: string };

/** Verlauf eines Leads (angegebener oder Antwort-Thread). Fehler werden zur deutschen Meldung. */
export async function ladeLeadThread(leadId: number, threadId: string | null, opt: LadeOptionen = {}): Promise<ThreadAntwort & { status: number }> {
  try {
    const lead = ladeLead(leadId);
    if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
    const t = leadThreads(lead);
    if (!t.postfach) throw new UniboxFehler('Diesem Lead ist kein Postfach zugeordnet (noch keine Mail gesendet).');
    const id = threadId ?? t.threads[t.start];
    if (!id) throw new UniboxFehler('Zu diesem Lead gibt es noch keinen Mail-Verlauf.');
    if (!t.threads.includes(id)) throw new UniboxFehler('Dieser Thread gehört nicht zu dem Lead.', 400);
    return { ok: true, status: 200, threadId: id, nachrichten: await ladeThread(t.postfach, id, opt) };
  } catch (e) {
    return { ok: false, status: e instanceof UniboxFehler ? e.status : 502, error: fehlerText(e) };
  }
}

// ---------------------------------------------------------------- Antworten

export const MAX_ANTWORT_ZEICHEN = 20_000;

export type AntwortOptionen = LadeOptionen & { sender?: GmailSender; now?: Date };
export type AntwortErgebnis = { ok: true; threadId: string; messageId: string } | { ok: false; status: number; error: string };

/** Absender, an die nie persönlich geantwortet wird (Bounces u. Ä.) */
const SYSTEMADRESSE = /^(mailer-daemon|postmaster|no-?reply|donotreply)@/i;

/**
 * Antwort im Thread: In-Reply-To/References auf die letzte fremde Nachricht, Betreff „Re: …“, über das Postfach des
 * Leads (keine Rotation), mit dessen Signatur. Kein Abmeldelink im Text, kein Tracking; List-Unsubscribe-Header bleibt.
 * Wird als sent_messages-Zeile mit step = ANTWORT_STEP protokolliert (zählt nicht gegen Limits, nicht in der Analyse).
 */
export async function sendeAntwort(leadId: number, textRoh: string, threadWunsch: string | null, opt: AntwortOptionen = {}): Promise<AntwortErgebnis> {
  const text = textRoh.replace(/\r\n?/g, '\n').trim();
  if (!text) return { ok: false, status: 400, error: 'Bitte einen Antworttext eingeben.' };
  if (text.length > MAX_ANTWORT_ZEICHEN) return { ok: false, status: 400, error: `Die Antwort ist zu lang (höchstens ${MAX_ANTWORT_ZEICHEN} Zeichen).` };
  const lead = ladeLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
  const jetzt = opt.now ?? new Date();
  try {
    const t = leadThreads(lead);
    const postfach = t.postfach;
    if (!postfach) throw new UniboxFehler('Diesem Lead ist kein Postfach zugeordnet (noch keine Mail gesendet).');
    pruefeLesezugriff(postfach);
    if (postfach.fehler && !istBounceFehler(postfach.fehler)) throw new UniboxFehler(`Das Postfach ${postfach.email} hat einen Fehler (bitte neu verbinden): ${postfach.fehler}`);
    const threadId = threadWunsch ?? t.threads[t.start];
    if (!threadId) throw new UniboxFehler('Zu diesem Lead gibt es noch keinen Mail-Verlauf.');
    if (!t.threads.includes(threadId)) throw new UniboxFehler('Dieser Thread gehört nicht zu dem Lead.', 400);

    // Immer frisch lesen: die Message-ID der letzten fremden Nachricht muss stimmen
    const nachrichten = await ladeThreadMitKopf(postfach, threadId, { ...opt, frisch: true });
    const ziel = [...nachrichten].reverse().find((n) => !n.eigene && n.messageId) ?? [...nachrichten].reverse().find((n) => n.messageId);
    if (nachrichten.length === 0) throw new UniboxFehler('Der Thread ist leer – es gibt nichts, worauf geantwortet werden könnte.');
    const ausFremd = ziel && !ziel.eigene ? extrahiereAdresse(ziel.replyTo || ziel.von) : '';
    const an = ausFremd && !SYSTEMADRESSE.test(ausFremd) ? ausFremd : lead.email;
    const betreff = antwortBetreff(ziel?.betreff || nachrichten[nachrichten.length - 1].betreff || 'Ihre Nachricht');

    const mail = buildAntwortMail(text, absenderSignatur(postfach));
    const von = senderInfo(postfach);
    const appUrl = getEnv().APP_URL.replace(/\/$/, '');
    const messageId = neueMessageId(von.email);
    const kette = ziel?.messageId ? [...(ziel.references ?? '').split(/\s+/).filter(Boolean), ziel.messageId].slice(-12).join(' ') : undefined;
    const raw = buildMime({
      from: von,
      to: an,
      subject: betreff,
      html: mail.html,
      text: mail.text,
      listUnsubscribeUrl: oneClickUrl(appUrl, lead.slug),
      listUnsubscribeMailto: `mailto:${von.email}?subject=Abmelden`,
      inReplyTo: ziel?.messageId ?? undefined,
      references: kette,
      messageId,
      date: jetzt,
    });

    let res: { id: string; threadId: string };
    try {
      res = await (opt.sender ?? treiberFuer(postfach).senden)(raw, threadId, postfach);
    } catch (e) {
      // Nur Fehler des Sendens betreffen den Versandzustand des Postfachs (nicht das Lesen)
      if (e instanceof GmailSendError) merkePostfachFehler(e.info.art, e.info.meldung, postfach, jetzt);
      throw e;
    }
    getDb()
      .insert(schema.sentMessages)
      .values({ leadId: lead.id, campaignId: lead.campaignId, step: ANTWORT_STEP, variante: null, gmailMessageId: res.id, gmailThreadId: res.threadId || threadId, absenderId: postfach.id, sentAt: jetzt })
      .run();
    getDb().update(schema.leads).set({ antwortGelesen: true }).where(eq(schema.leads.id, lead.id)).run();
    leereThreadCache(postfach.id, threadId);
    return { ok: true, threadId: res.threadId || threadId, messageId: res.id };
  } catch (e) {
    return { ok: false, status: e instanceof UniboxFehler ? e.status : 502, error: fehlerText(e) };
  }
}

// ---------------------------------------------------------------- Route-Handler (mit austauschbaren Abhängigkeiten)

const antwortSchema = z.object({ text: z.string(), threadId: z.string().min(1).max(200).optional() });

type RouteKontext = { params: Promise<{ id: string }> };

/** POST /api/leads/[id]/antworten {text, threadId?}; `opt` ersetzt Gmail (Tests). */
export function antwortHandler(opt: AntwortOptionen = {}) {
  return async (req: Request, ctx: RouteKontext): Promise<Response> => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: 'Ungültiger Lead' }, { status: 404 });
    let body: z.infer<typeof antwortSchema>;
    try {
      body = antwortSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: 'Ungültige Eingabe: {text} erwartet.' }, { status: 400 });
    }
    const res = await sendeAntwort(id, body.text, body.threadId ?? null, opt);
    if (res.ok) return NextResponse.json({ ok: true, threadId: res.threadId });
    return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  };
}

/** GET /api/leads/[id]/thread?thread=ID → {ok, threadId, nachrichten}; Fehler als {ok:false,error} (Status 200 bei Gmail-Problemen, damit die UI sie anzeigt). */
export function threadHandler(opt: LadeOptionen = {}) {
  return async (req: Request, ctx: RouteKontext): Promise<Response> => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: 'Ungültiger Lead' }, { status: 404 });
    const thread = new URL(req.url).searchParams.get('thread');
    const res = await ladeLeadThread(id, thread || null, opt);
    if (res.ok) return NextResponse.json({ ok: true, threadId: res.threadId, nachrichten: res.nachrichten });
    return NextResponse.json({ ok: false, error: res.error }, { status: res.status === 404 || res.status === 400 ? res.status : 200 });
  };
}

