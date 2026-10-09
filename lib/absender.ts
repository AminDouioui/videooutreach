import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { GMAIL_METADATA_SCOPE } from './gmail-scopes';
import { postfachLimit, type PostfachZustand } from './rotation';
import { getSetting, rampeEinstellung } from './settings';
import { startOfDayBerlinMs, todayBerlin } from './time';

// Absender-Postfächer: Laden, Zustand für die Rotation, Verbindungs- und Fehlerstatus (DB-Teil; die Auswahl selbst ist rein: lib/rotation.ts)

export type Absender = typeof schema.absender.$inferSelect;

export function ladeAbsender(): Absender[] {
  return getDb().select().from(schema.absender).orderBy(asc(schema.absender.id)).all();
}

export function ladeAbsenderMitId(id: number): Absender | null {
  return getDb().select().from(schema.absender).where(eq(schema.absender.id, id)).get() ?? null;
}

/** Hat das Postfach einen gespeicherten Token? (entfernte/getrennte Postfächer: nein) */
export function postfachVerbunden(a: Pick<Absender, 'refreshTokenEnc'>): boolean {
  return a.refreshTokenEnc !== '';
}

/** Darf die App Threads dieses Postfachs auf Antworten prüfen? (Verbindung vor der Follow-up-Funktion hat nur gmail.send) */
export function kannAntwortenPruefen(a: Pick<Absender, 'refreshTokenEnc' | 'scopes'>): boolean {
  return postfachVerbunden(a) && a.scopes.includes(GMAIL_METADATA_SCOPE);
}

/** Mindestens ein Postfach ist verbunden (unabhängig von aktiv/pausiert) */
export function hatVerbundenesPostfach(): boolean {
  return ladeAbsender().some(postfachVerbunden);
}

/** Absendername: eigener Name des Postfachs, sonst der globale Absendername (Einstellung/.env) */
export function absenderName(a: Pick<Absender, 'name'> | null | undefined): string {
  return (a?.name ?? '').trim() || (getSetting('sender_name') ?? '').trim() || getEnv().SENDER_NAME?.trim() || '';
}

/** Signatur: eigene des Postfachs, sonst die globale */
export function absenderSignatur(a: Pick<Absender, 'signatur'> | null | undefined): string {
  return a?.signatur ?? getSetting('signature') ?? '';
}

/**
 * Postfach eines Leads für Follow-ups und Antwortprüfung: das der Erstmail (leads.absender_id). Altbestand ohne
 * Zuordnung läuft über das älteste aktive, verbundene Postfach. Kann inaktiv/getrennt/fehlerhaft sein – dann wartet der Lead.
 */
export function postfachFuerLead(lead: { absenderId: number | null }): Absender | null {
  if (lead.absenderId !== null && lead.absenderId !== undefined) return ladeAbsenderMitId(lead.absenderId);
  return ladeAbsender().find((a) => a.aktiv && postfachVerbunden(a)) ?? null;
}

/** Warum ein Postfach (für Follow-ups, Antwortprüfung, Testmail) nicht zum Senden taugt; null = nutzbar. */
export function postfachNichtNutzbar(a: Absender): string | null {
  if (!a.aktiv) return `Postfach ${a.email} ist pausiert`;
  if (!postfachVerbunden(a)) return `Postfach ${a.email} ist nicht verbunden`;
  if (a.fehler) return `Postfach ${a.email} hat einen Fehler und ist pausiert (bitte neu verbinden): ${a.fehler}`;
  return null;
}

// ---------------------------------------------------------------- Zähler & Zustand

/** Heute (Berlin) gesendete Mails je Postfach (inkl. Follow-ups). */
export function heuteGesendetProPostfach(jetzt: Date = new Date()): Map<number, number> {
  const rows = getDb()
    .select({ id: schema.sentMessages.absenderId, n: sql<number>`count(*)` })
    .from(schema.sentMessages)
    .where(and(gte(schema.sentMessages.sentAt, new Date(startOfDayBerlinMs(jetzt))), sql`${schema.sentMessages.absenderId} is not null`))
    .groupBy(schema.sentMessages.absenderId)
    .all();
  return new Map(rows.map((r) => [r.id as number, r.n]));
}

/** Datum (Berlin) der ersten je von diesem Postfach gesendeten Mail, je Postfach. */
function ersteVersandTage(): Map<number, string> {
  const rows = getDb()
    .select({ id: schema.sentMessages.absenderId, erste: sql<number>`min(${schema.sentMessages.sentAt})` })
    .from(schema.sentMessages)
    .where(sql`${schema.sentMessages.absenderId} is not null`)
    .groupBy(schema.sentMessages.absenderId)
    .all();
  return new Map(rows.map((r) => [r.id as number, todayBerlin(new Date(r.erste))]));
}

/**
 * Zustand aller Postfächer für Rotation und Anzeige. Effektives Limit: min(Tageslimit, Rampe), wobei die Rampe
 * (falls aktiv) je Postfach läuft – Beginn: rampe_beginn des Postfachs, sonst Tag seiner ersten Mail, sonst heute.
 */
export function ladePostfachZustaende(jetzt: Date = new Date()): { absender: Absender; zustand: PostfachZustand }[] {
  const heute = todayBerlin(jetzt);
  const gesendet = heuteGesendetProPostfach(jetzt);
  const rampe = rampeEinstellung();
  const erste = rampe.aktiv ? ersteVersandTage() : new Map<number, string>();
  return ladeAbsender().map((a) => ({
    absender: a,
    zustand: {
      id: a.id,
      aktiv: a.aktiv,
      verbunden: postfachVerbunden(a),
      fehler: a.fehler,
      quotaGestopptAm: a.quotaGestopptAm,
      nextSendAt: a.nextSendAt,
      limit: postfachLimit({ tageslimit: a.tageslimit, rampe, beginn: a.rampeBeginn ?? erste.get(a.id) ?? heute, heute }),
      heuteGesendet: gesendet.get(a.id) ?? 0,
    },
  }));
}

// ---------------------------------------------------------------- Zustand schreiben

export function markiereAuthFehler(id: number, meldung: string): void {
  getDb().update(schema.absender).set({ fehler: meldung.slice(0, 500) }).where(eq(schema.absender.id, id)).run();
}

export function stoppeQuota(id: number, jetzt: Date = new Date()): void {
  getDb().update(schema.absender).set({ quotaGestopptAm: todayBerlin(jetzt) }).where(eq(schema.absender.id, id)).run();
}

export function setzeNaechstenVersand(id: number, ms: number): void {
  getDb().update(schema.absender).set({ nextSendAt: ms }).where(eq(schema.absender.id, id)).run();
}

// ---------------------------------------------------------------- Verbinden, bearbeiten, entfernen

/**
 * Speichert eine neue oder erneuerte Verbindung (Token muss bereits verschlüsselt sein). Gleiche Adresse =
 * Token aktualisieren und Fehler zurücksetzen; war das Postfach entfernt (kein Token), wird es wieder aktiviert.
 */
export function speichereVerbindung(v: { email: string; refreshTokenEnc: string; scopes: string }): { absender: Absender; neu: boolean } {
  const db = getDb();
  const email = v.email.trim().toLowerCase();
  const vorhanden = db.select().from(schema.absender).where(eq(schema.absender.email, email)).get();
  if (!vorhanden) {
    const row = db.insert(schema.absender).values({ email, refreshTokenEnc: v.refreshTokenEnc, scopes: v.scopes, aktiv: true }).returning().get();
    return { absender: row, neu: true };
  }
  const row = db
    .update(schema.absender)
    .set({
      refreshTokenEnc: v.refreshTokenEnc,
      scopes: v.scopes,
      fehler: null,
      ...(postfachVerbunden(vorhanden) ? {} : { aktiv: true }),
    })
    .where(eq(schema.absender.id, vorhanden.id))
    .returning()
    .get();
  return { absender: row, neu: false };
}

export type AbsenderAenderung = { name?: string | null; tageslimit?: number; signatur?: string | null; aktiv?: boolean; rampeBeginn?: string | null };

export function aktualisiereAbsender(id: number, a: AbsenderAenderung): Absender | null {
  const set: Partial<typeof schema.absender.$inferInsert> = {};
  if (a.name !== undefined) set.name = a.name?.trim() ? a.name.trim() : null;
  if (a.tageslimit !== undefined) set.tageslimit = Math.max(1, Math.floor(a.tageslimit));
  if (a.signatur !== undefined) set.signatur = a.signatur !== null && a.signatur.trim() !== '' ? a.signatur : null;
  if (a.aktiv !== undefined) set.aktiv = a.aktiv;
  if (a.rampeBeginn !== undefined) set.rampeBeginn = a.rampeBeginn && /^\d{4}-\d{2}-\d{2}$/.test(a.rampeBeginn) ? a.rampeBeginn : null;
  if (Object.keys(set).length === 0) return ladeAbsenderMitId(id);
  return getDb().update(schema.absender).set(set).where(eq(schema.absender.id, id)).returning().get() ?? null;
}

/** Wie viele Leads/Mails hängen an diesem Postfach? */
export function anzahlZuordnungen(id: number): { leads: number; mails: number } {
  const db = getDb();
  const leads = db.select({ n: sql<number>`count(*)` }).from(schema.leads).where(eq(schema.leads.absenderId, id)).get()?.n ?? 0;
  const mails = db.select({ n: sql<number>`count(*)` }).from(schema.sentMessages).where(eq(schema.sentMessages.absenderId, id)).get()?.n ?? 0;
  return { leads, mails };
}

/**
 * Entfernt ein Postfach. Hängen Leads/Mails daran, bleibt der Eintrag erhalten (Token gelöscht, deaktiviert) –
 * Follow-ups dieser Leads warten dann, statt über ein fremdes Postfach zu laufen. Sonst wird die Zeile gelöscht.
 */
export function entferneAbsender(id: number): 'geloescht' | 'getrennt' | null {
  const db = getDb();
  if (!ladeAbsenderMitId(id)) return null;
  const z = anzahlZuordnungen(id);
  if (z.leads === 0 && z.mails === 0) {
    db.delete(schema.absender).where(eq(schema.absender.id, id)).run();
    return 'geloescht';
  }
  db.update(schema.absender).set({ refreshTokenEnc: '', scopes: '', aktiv: false, fehler: null, nextSendAt: null }).where(eq(schema.absender.id, id)).run();
  return 'getrennt';
}
