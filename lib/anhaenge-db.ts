import { randomBytes } from 'crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { dateinameFuerPlatte, pruefeDatei, pruefeGrenzen } from './anhaenge';
import { getDb, schema } from './db';
import { getEnv } from './env';

// Dateianhänge der Mails: Datensätze (Tabelle anhaenge) und Dateien unter ${DATA_DIR}/anhaenge/<Kampagne>/.
// Die Dateien liegen bewusst nicht unter media/ und werden nie öffentlich ausgeliefert.

export type Anhang = typeof schema.anhaenge.$inferSelect;
/** Datei, wie sie in die Mail kommt */
export type AnhangDatei = { dateiname: string; mime: string; inhalt: Buffer };

/** Wurzel der Anhang-Dateien (`${DATA_DIR}/anhaenge`). */
export function anhangWurzel(): string {
  return path.join(path.resolve(getEnv().DATA_DIR), 'anhaenge');
}

/** Absoluter Pfad einer Anhang-Datei; verweigert alles, was außerhalb der Anhang-Wurzel läge. */
export function anhangPfad(relativ: string): string {
  const abs = path.resolve(getEnv().DATA_DIR, relativ);
  const wurzel = anhangWurzel();
  if (!abs.startsWith(wurzel + path.sep)) throw new Error('Ungültiger Anhang-Pfad');
  return abs;
}

function loescheDatei(relativ: string): void {
  try {
    fs.unlinkSync(anhangPfad(relativ));
  } catch {
    // Datei existiert nicht mehr – ok
  }
}

/** Anhänge eines Schritts: followupId null = Erstmail. */
export function ladeAnhaenge(campaignId: number, followupId: number | null): Anhang[] {
  const a = schema.anhaenge;
  return getDb()
    .select()
    .from(a)
    .where(and(eq(a.campaignId, campaignId), followupId === null ? isNull(a.followupId) : eq(a.followupId, followupId)))
    .orderBy(asc(a.id))
    .all();
}

/** Alle Anhänge einer Kampagne (Erstmail und Follow-ups) */
export function ladeAlleAnhaenge(campaignId: number): Anhang[] {
  return getDb().select().from(schema.anhaenge).where(eq(schema.anhaenge.campaignId, campaignId)).orderBy(asc(schema.anhaenge.id)).all();
}

export function ladeAnhang(id: number): Anhang | undefined {
  return getDb().select().from(schema.anhaenge).where(eq(schema.anhaenge.id, id)).get();
}

export type SpeicherErgebnis = { ok: true; anhang: Anhang } | { ok: false; fehler: string; status: number };

/** Prüft und speichert einen Anhang (Datei + Datensatz). Der Schritt muss zur Kampagne gehören. */
export function speichereAnhang(campaignId: number, followupId: number | null, name: string, inhalt: Buffer): SpeicherErgebnis {
  const db = getDb();
  if (followupId !== null) {
    const f = db.select({ id: schema.followups.id }).from(schema.followups).where(and(eq(schema.followups.id, followupId), eq(schema.followups.campaignId, campaignId))).get();
    if (!f) return { ok: false, fehler: 'Follow-up nicht gefunden (bitte zuerst speichern)', status: 404 };
  }
  const pruefung = pruefeDatei(name, inhalt);
  if (!pruefung.ok) return { ok: false, fehler: pruefung.fehler, status: 400 };
  const grenze = pruefeGrenzen(ladeAnhaenge(campaignId, followupId), inhalt.length);
  if (grenze) return { ok: false, fehler: grenze, status: 400 };

  const relativ = path.posix.join('anhaenge', String(campaignId), `${randomBytes(8).toString('hex')}-${dateinameFuerPlatte(pruefung.dateiname)}`);
  const abs = anhangPfad(relativ);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, inhalt);
  try {
    const anhang = db.insert(schema.anhaenge).values({ campaignId, followupId, dateiname: pruefung.dateiname, mime: pruefung.mime, groesse: inhalt.length, pfad: relativ }).returning().get();
    return { ok: true, anhang };
  } catch (e) {
    loescheDatei(relativ);
    throw e;
  }
}

/** Anhang samt Datei löschen. Liefert false, wenn es ihn nicht gab. */
export function loescheAnhang(id: number): boolean {
  const a = ladeAnhang(id);
  if (!a) return false;
  getDb().delete(schema.anhaenge).where(eq(schema.anhaenge.id, id)).run();
  loescheDatei(a.pfad);
  return true;
}

/** Dateien zu bereits gelöschten (oder gleich zu löschenden) Datensätzen entfernen. */
export function loescheAnhangDateien(anhaenge: Pick<Anhang, 'pfad'>[]): void {
  for (const a of anhaenge) loescheDatei(a.pfad);
}

/** Anhänge der angegebenen Follow-ups: erst lesen, dann (per Cascade) mit den Follow-ups löschen, dann Dateien entfernen. */
export function anhaengeVonFollowups(followupIds: number[]): Anhang[] {
  if (followupIds.length === 0) return [];
  return getDb().select().from(schema.anhaenge).where(inArray(schema.anhaenge.followupId, followupIds)).all();
}

/** Ganzes Anhang-Verzeichnis einer (gelöschten) Kampagne entfernen. */
export function loescheAnhangVerzeichnis(campaignId: number): void {
  fs.rmSync(path.join(anhangWurzel(), String(campaignId)), { recursive: true, force: true });
}

/**
 * Dateien eines Schritts für den Versand laden. Fehlt eine Datei auf der Platte, wird nicht ohne sie gesendet:
 * Wirft einen Fehler mit verständlicher Meldung (der Versand meldet ihn am Lead bzw. versucht es später erneut).
 */
export function ladeAnhangDateien(campaignId: number, followupId: number | null): AnhangDatei[] {
  return ladeAnhaenge(campaignId, followupId).map((a) => {
    try {
      return { dateiname: a.dateiname, mime: a.mime, inhalt: fs.readFileSync(anhangPfad(a.pfad)) };
    } catch {
      throw new Error(`Anhang „${a.dateiname}“ fehlt auf dem Server – bitte neu hochladen oder entfernen`);
    }
  });
}

/**
 * Kopiert die Anhänge einer Kampagne in eine andere (Duplizieren). `followupMap` ordnet alte → neue Follow-up-IDs zu.
 * Dateien werden kopiert, damit das Löschen der einen Kampagne die andere nicht berührt.
 */
export function kopiereAnhaenge(vonCampaignId: number, nachCampaignId: number, followupMap: Map<number, number>): void {
  const db = getDb();
  for (const a of ladeAlleAnhaenge(vonCampaignId)) {
    const neuFollowup = a.followupId === null ? null : followupMap.get(a.followupId);
    if (neuFollowup === undefined) continue;
    const relativ = path.posix.join('anhaenge', String(nachCampaignId), `${randomBytes(8).toString('hex')}-${dateinameFuerPlatte(a.dateiname)}`);
    try {
      const ziel = anhangPfad(relativ);
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      fs.copyFileSync(anhangPfad(a.pfad), ziel);
    } catch {
      continue; // Quelldatei fehlt – nichts zu kopieren
    }
    db.insert(schema.anhaenge).values({ campaignId: nachCampaignId, followupId: neuFollowup, dateiname: a.dateiname, mime: a.mime, groesse: a.groesse, pfad: relativ }).run();
  }
}
