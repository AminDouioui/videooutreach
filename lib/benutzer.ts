import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Rolle } from './auth';
import { getDb, schema } from './db';
import { hashePasswort, passwortProblem, pruefePasswort } from './passwort';

// Benutzerverwaltung (Team-Zugänge): Benutzer, Einladungen, Konto. Reine DB-Logik ohne HTTP; die Routen prüfen Rollen.

export type Benutzer = typeof schema.benutzer.$inferSelect;
/** Benutzer ohne Passwort-Hash (für Anzeige und API-Antworten) */
export type BenutzerOeffentlich = Omit<Benutzer, 'passwortHash'>;
export type Einladung = typeof schema.einladungen.$inferSelect;

export const EINLADUNG_GUELTIG_MS = 7 * 24 * 60 * 60 * 1000;

export const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email('Bitte eine gültige E-Mail-Adresse angeben');

export function normalisiereEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ohneHash(b: Benutzer): BenutzerOeffentlich {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwortHash, ...rest } = b;
  return rest;
}

export function ladeBenutzer(id: number): Benutzer | undefined {
  return getDb().select().from(schema.benutzer).where(eq(schema.benutzer.id, id)).get();
}

export function ladeBenutzerPerEmail(email: string): Benutzer | undefined {
  return getDb().select().from(schema.benutzer).where(eq(schema.benutzer.email, normalisiereEmail(email))).get();
}

export function listeBenutzer(): BenutzerOeffentlich[] {
  return getDb().select().from(schema.benutzer).orderBy(asc(schema.benutzer.name)).all().map(ohneHash);
}

/** Offene (nicht angenommene) Einladungen, neueste zuerst; abgelaufene werden mit `abgelaufen` markiert. */
export function listeEinladungen(jetzt: Date = new Date()): (Omit<Einladung, 'tokenHash'> & { abgelaufen: boolean })[] {
  return getDb()
    .select()
    .from(schema.einladungen)
    .where(isNull(schema.einladungen.angenommenAt))
    .orderBy(desc(schema.einladungen.id))
    .all()
    .map((e) => ({ id: e.id, email: e.email, rolle: e.rolle, ablaufAt: e.ablaufAt, angenommenAt: e.angenommenAt, createdAt: e.createdAt, abgelaufen: e.ablaufAt.getTime() <= jetzt.getTime() }));
}

/** Anzahl aktiver Benutzer mit Rolle admin (der ADMIN_PASSWORD-Zugang zählt nicht mit). */
export function anzahlAktiveAdmins(ausser?: number): number {
  const rows = getDb()
    .select({ id: schema.benutzer.id })
    .from(schema.benutzer)
    .where(and(eq(schema.benutzer.rolle, 'admin'), eq(schema.benutzer.aktiv, true), ausser === undefined ? undefined : ne(schema.benutzer.id, ausser)))
    .all();
  return rows.length;
}

export type Ergebnis<T = object> = ({ ok: true } & T) | { ok: false; fehler: string; status: number };

// ---------- Einladungen ----------

function neuerToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Legt eine Einladung an (ältere offene für dieselbe Adresse werden ersetzt). Der Klartext-Token steht nur im Ergebnis.
 * Existiert die Adresse schon als Benutzer, ist es eine Passwort-Zurücksetzung (nur für aktive Benutzer).
 */
export function erstelleEinladung(emailRoh: string, rolle: Rolle, jetzt: Date = new Date()): Ergebnis<{ token: string; einladung: Einladung; zuruecksetzen: boolean }> {
  const email = normalisiereEmail(emailRoh);
  const vorhanden = ladeBenutzerPerEmail(email);
  if (vorhanden && !vorhanden.aktiv) return { ok: false, fehler: 'Dieser Benutzer ist deaktiviert. Bitte zuerst aktivieren.', status: 409 };
  const db = getDb();
  const token = neuerToken();
  const einladung = db.transaction((tx) => {
    tx.delete(schema.einladungen).where(and(eq(schema.einladungen.email, email), isNull(schema.einladungen.angenommenAt))).run();
    return tx
      .insert(schema.einladungen)
      .values({ email, rolle: vorhanden ? vorhanden.rolle : rolle, tokenHash: hashToken(token), ablaufAt: new Date(jetzt.getTime() + EINLADUNG_GUELTIG_MS), createdAt: jetzt })
      .returning()
      .get();
  });
  return { ok: true, token, einladung, zuruecksetzen: !!vorhanden };
}

export function erstelleEinladungFuerNeuenBenutzer(emailRoh: string, rolle: Rolle, jetzt: Date = new Date()): Ergebnis<{ token: string; einladung: Einladung; zuruecksetzen: boolean }> {
  if (ladeBenutzerPerEmail(emailRoh)) return { ok: false, fehler: 'Für diese E-Mail-Adresse gibt es schon einen Benutzer. Nutzen Sie „Passwort zurücksetzen“.', status: 409 };
  return erstelleEinladung(emailRoh, rolle, jetzt);
}

export function setzePasswortZurueck(benutzerId: number, jetzt: Date = new Date()): Ergebnis<{ token: string; einladung: Einladung; zuruecksetzen: boolean }> {
  const b = ladeBenutzer(benutzerId);
  if (!b) return { ok: false, fehler: 'Benutzer nicht gefunden', status: 404 };
  return erstelleEinladung(b.email, b.rolle, jetzt);
}

export function widerrufeEinladung(id: number): boolean {
  return getDb().delete(schema.einladungen).where(and(eq(schema.einladungen.id, id), isNull(schema.einladungen.angenommenAt))).run().changes > 0;
}

export type EinladungsStatus =
  | { status: 'gueltig'; email: string; rolle: Rolle; zuruecksetzen: boolean; einladung: Einladung }
  | { status: 'abgelaufen' | 'benutzt' | 'unbekannt' | 'deaktiviert' };

export const EINLADUNG_MELDUNG: Record<Exclude<EinladungsStatus['status'], 'gueltig'>, string> = {
  abgelaufen: 'Diese Einladung ist abgelaufen. Bitte lassen Sie sich einen neuen Link schicken.',
  benutzt: 'Diese Einladung wurde bereits verwendet. Melden Sie sich einfach an.',
  unbekannt: 'Dieser Einladungslink ist ungültig. Bitte prüfen Sie den Link oder lassen Sie sich einen neuen schicken.',
  deaktiviert: 'Dieses Konto ist deaktiviert. Bitte wenden Sie sich an Ihren Admin.',
};

export function pruefeEinladung(token: string, jetzt: Date = new Date()): EinladungsStatus {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return { status: 'unbekannt' };
  const e = getDb().select().from(schema.einladungen).where(eq(schema.einladungen.tokenHash, hashToken(token))).get();
  if (!e) return { status: 'unbekannt' };
  if (e.angenommenAt) return { status: 'benutzt' };
  if (e.ablaufAt.getTime() <= jetzt.getTime()) return { status: 'abgelaufen' };
  const b = ladeBenutzerPerEmail(e.email);
  if (b && !b.aktiv) return { status: 'deaktiviert' };
  return { status: 'gueltig', email: e.email, rolle: e.rolle, zuruecksetzen: !!b, einladung: e };
}

/**
 * Nimmt eine Einladung an: legt den Benutzer an (bzw. setzt bei einer Zurücksetzung das Passwort neu), markiert die
 * Einladung als angenommen. Das Markieren ist atomar – ein Token funktioniert genau einmal.
 */
export async function nehmeEinladungAn(token: string, name: string, passwort: string, jetzt: Date = new Date()): Promise<Ergebnis<{ benutzer: Benutzer }>> {
  const st = pruefeEinladung(token, jetzt);
  if (st.status !== 'gueltig') return { ok: false, fehler: EINLADUNG_MELDUNG[st.status], status: st.status === 'unbekannt' ? 404 : 410 };
  const problem = passwortProblem(passwort);
  if (problem) return { ok: false, fehler: problem, status: 400 };
  const anzeigename = name.trim();
  if (!st.zuruecksetzen && !anzeigename) return { ok: false, fehler: 'Bitte geben Sie Ihren Namen an.', status: 400 };
  const hash = await hashePasswort(passwort);

  try {
    const benutzer = getDb().transaction((tx) => {
      const geclaimt = tx
        .update(schema.einladungen)
        .set({ angenommenAt: jetzt })
        .where(and(eq(schema.einladungen.id, st.einladung.id), isNull(schema.einladungen.angenommenAt)))
        .run().changes;
      if (geclaimt !== 1) return null;
      const vorhanden = tx.select().from(schema.benutzer).where(eq(schema.benutzer.email, st.email)).get();
      if (vorhanden) {
        if (!vorhanden.aktiv) throw new Error('deaktiviert');
        return tx
          .update(schema.benutzer)
          .set({ passwortHash: hash, sessionVersion: vorhanden.sessionVersion + 1, letzterLoginAt: jetzt, ...(anzeigename ? { name: anzeigename } : {}) })
          .where(eq(schema.benutzer.id, vorhanden.id))
          .returning()
          .get();
      }
      return tx.insert(schema.benutzer).values({ email: st.email, name: anzeigename.slice(0, 120), passwortHash: hash, rolle: st.rolle, letzterLoginAt: jetzt, createdAt: jetzt }).returning().get();
    });
    if (!benutzer) return { ok: false, fehler: EINLADUNG_MELDUNG.benutzt, status: 410 };
    return { ok: true, benutzer };
  } catch (e) {
    if (e instanceof Error && e.message === 'deaktiviert') return { ok: false, fehler: EINLADUNG_MELDUNG.deaktiviert, status: 410 };
    throw e;
  }
}

// ---------- Verwaltung ----------

function selbstSperre(zielId: number, akteurId: number, was: string): string | null {
  return zielId === akteurId ? `Sie können sich nicht selbst ${was}.` : null;
}

export function aendereRolle(zielId: number, rolle: Rolle, akteurId: number): Ergebnis<{ benutzer: BenutzerOeffentlich }> {
  const b = ladeBenutzer(zielId);
  if (!b) return { ok: false, fehler: 'Benutzer nicht gefunden', status: 404 };
  if (b.rolle === rolle) return { ok: true, benutzer: ohneHash(b) };
  if (b.rolle === 'admin' && b.aktiv && zielId === akteurId && anzahlAktiveAdmins(zielId) === 0) {
    return { ok: false, fehler: 'Sie sind der letzte Admin unter den Benutzern und können sich die Admin-Rolle nicht entziehen. (Der Zugang über ADMIN_PASSWORD bleibt immer bestehen.)', status: 409 };
  }
  const neu = getDb().update(schema.benutzer).set({ rolle, sessionVersion: b.sessionVersion + 1 }).where(eq(schema.benutzer.id, zielId)).returning().get();
  return { ok: true, benutzer: ohneHash(neu) };
}

export function setzeAktiv(zielId: number, aktiv: boolean, akteurId: number): Ergebnis<{ benutzer: BenutzerOeffentlich }> {
  const b = ladeBenutzer(zielId);
  if (!b) return { ok: false, fehler: 'Benutzer nicht gefunden', status: 404 };
  if (!aktiv) {
    const s = selbstSperre(zielId, akteurId, 'deaktivieren');
    if (s) return { ok: false, fehler: s, status: 409 };
  }
  // Jede Änderung entwertet vorhandene Sessions (beim Deaktivieren sofort wirksam)
  const neu = getDb().update(schema.benutzer).set({ aktiv, sessionVersion: b.sessionVersion + 1 }).where(eq(schema.benutzer.id, zielId)).returning().get();
  return { ok: true, benutzer: ohneHash(neu) };
}

export function loescheBenutzer(zielId: number, akteurId: number): Ergebnis {
  const b = ladeBenutzer(zielId);
  if (!b) return { ok: false, fehler: 'Benutzer nicht gefunden', status: 404 };
  const s = selbstSperre(zielId, akteurId, 'löschen');
  if (s) return { ok: false, fehler: s, status: 409 };
  getDb().delete(schema.benutzer).where(eq(schema.benutzer.id, zielId)).run();
  // Offene Einladungen/Zurücksetzungen für diese Adresse verfallen mit dem Benutzer
  getDb().delete(schema.einladungen).where(and(eq(schema.einladungen.email, b.email), isNull(schema.einladungen.angenommenAt))).run();
  return { ok: true };
}

// ---------- Mein Konto ----------

export async function aendereKonto(
  benutzerId: number,
  eingabe: { name?: string; altesPasswort?: string; neuesPasswort?: string },
): Promise<Ergebnis<{ benutzer: BenutzerOeffentlich }>> {
  const b = ladeBenutzer(benutzerId);
  if (!b || !b.aktiv) return { ok: false, fehler: 'Benutzer nicht gefunden', status: 404 };
  const set: Partial<typeof schema.benutzer.$inferInsert> = {};
  if (eingabe.name !== undefined) {
    const name = eingabe.name.trim();
    if (!name) return { ok: false, fehler: 'Der Name darf nicht leer sein.', status: 400 };
    set.name = name.slice(0, 120);
  }
  if (eingabe.neuesPasswort !== undefined) {
    if (!eingabe.altesPasswort || !(await pruefePasswort(eingabe.altesPasswort, b.passwortHash))) return { ok: false, fehler: 'Das bisherige Passwort ist falsch.', status: 403 };
    const problem = passwortProblem(eingabe.neuesPasswort);
    if (problem) return { ok: false, fehler: problem, status: 400 };
    set.passwortHash = await hashePasswort(eingabe.neuesPasswort);
    // Andere Sessions dieses Benutzers werden damit ungültig; die aktuelle bekommt ein neues Token
    set.sessionVersion = b.sessionVersion + 1;
  }
  if (Object.keys(set).length === 0) return { ok: true, benutzer: ohneHash(b) };
  const neu = getDb().update(schema.benutzer).set(set).where(eq(schema.benutzer.id, benutzerId)).returning().get();
  return { ok: true, benutzer: ohneHash(neu) };
}

export function vermerkeLogin(benutzerId: number, jetzt: Date = new Date()): void {
  getDb().update(schema.benutzer).set({ letzterLoginAt: jetzt }).where(eq(schema.benutzer.id, benutzerId)).run();
}
