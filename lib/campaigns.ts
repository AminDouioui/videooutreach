import { and, eq, inArray, sql } from 'drizzle-orm';
import { anhaengeVonFollowups, kopiereAnhaenge, loescheAnhangDateien, loescheAnhangVerzeichnis } from './anhaenge-db';
import { istVerhalten } from './verhalten';
import { getDb, schema } from './db';
import { firmenDuplikate, firmenSchluessel } from './firma';
import { deleteMedia } from './media';
import { schliesseKampagneAb, stoppeRender } from './render-queue';
import { normalisiereSpaltenname } from './vorlage';

export const STANDARD_BETREFF = 'Kurzes Video für {{firma}}';
export const STANDARD_TEXT = `{{begruessung}},

ich habe für {{firma}} ein kurzes, persönliches Video aufgenommen:

{{vorschaubild}}

Wenn das für Sie interessant ist, freue ich mich über eine kurze Rückmeldung oder einen 15-Minuten-Termin.`;

export const STANDARD_BETREFF_OHNE_VIDEO = 'Kurze Frage an {{firma}}';
export const STANDARD_TEXT_OHNE_VIDEO = `{{begruessung}},

ich melde mich kurz bei Ihnen, weil …

Wenn das für Sie interessant ist, freue ich mich über eine kurze Rückmeldung oder einen 15-Minuten-Termin.`;

export type FollowupVarianteEingabe = { kuerzel: string; text: string; betreff?: string | null; aktiv?: boolean; verhalten?: string };
/** Variante A = body/betreff des Schritts; `varianten` sind B–E. Betreff gesetzt = neuer Thread statt „Re: …“. */
export type FollowupEingabe = { /** Bestehender Schritt (behält seine Anhänge); ohne Angabe oder unbekannt = neuer Schritt */ id?: number; waitDays: number; body: string; betreff?: string | null; varianten?: FollowupVarianteEingabe[] };

const leerZuNull = (b: string | null | undefined) => (b && b.trim() ? b.trim() : null);

/**
 * Follow-up-Schritte einer Kampagne speichern (Reihenfolge = Position), samt Varianten. Schritte mit bekannter `id`
 * werden aktualisiert und behalten ihre Anhänge; nicht mehr genannte Schritte werden samt Anhängen (auch Dateien)
 * gelöscht. Liefert die IDs der Schritte in der übergebenen Reihenfolge.
 */
export function speichereFollowups(campaignId: number, schritte: FollowupEingabe[]): number[] {
  const db = getDb();
  let entfernte: ReturnType<typeof anhaengeVonFollowups> = [];
  const ids = db.transaction((tx) => {
    const vorhanden = new Set(tx.select({ id: schema.followups.id }).from(schema.followups).where(eq(schema.followups.campaignId, campaignId)).all().map((r) => r.id));
    const behalten = new Set<number>();
    for (const s of schritte) if (s.id !== undefined && vorhanden.has(s.id) && !behalten.has(s.id)) behalten.add(s.id);
    const weg = [...vorhanden].filter((id) => !behalten.has(id));
    entfernte = anhaengeVonFollowups(weg);
    if (weg.length) tx.delete(schema.followups).where(inArray(schema.followups.id, weg)).run();
    const benutzt = new Set<number>();
    return schritte.map((s, i) => {
      const werte = { position: i + 1, waitDays: s.waitDays, body: s.body, betreff: leerZuNull(s.betreff) };
      let id: number;
      if (s.id !== undefined && behalten.has(s.id) && !benutzt.has(s.id)) {
        id = s.id;
        tx.update(schema.followups).set(werte).where(eq(schema.followups.id, id)).run();
        tx.delete(schema.followupVarianten).where(eq(schema.followupVarianten.followupId, id)).run();
      } else id = tx.insert(schema.followups).values({ campaignId, ...werte }).returning().get().id;
      benutzt.add(id);
      for (const v of s.varianten ?? []) {
        tx.insert(schema.followupVarianten).values({ followupId: id, kuerzel: v.kuerzel, text: v.text, betreff: leerZuNull(v.betreff), aktiv: v.aktiv ?? true, verhalten: istVerhalten(v.verhalten) ? v.verhalten : 'immer' }).run();
      }
      return id;
    });
  });
  // Dateien erst nach erfolgreicher Transaktion entfernen
  loescheAnhangDateien(entfernte);
  return ids;
}

/**
 * Kampagne endgültig löschen: Rendern stoppen, Leads/Events/Follow-ups/Versandprotokoll (Cascade) und
 * die gerenderten Videos + Vorschaubilder entfernen. Sperrliste und Abmeldungen bleiben erhalten.
 */
export function loescheKampagne(campaignId: number): { leads: number } | null {
  const db = getDb();
  const k = db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
  if (!k) return null;
  // Laufenden Render-Job abbrechen lassen, damit er keine Dateien mehr schreibt
  stoppeRender(campaignId);
  const slugs = db.select({ slug: schema.leads.slug }).from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).all();
  db.delete(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).run();
  for (const { slug } of slugs) deleteMedia(slug);
  // Anhänge: Datensätze sind per Cascade weg, die Dateien nicht
  loescheAnhangVerzeichnis(campaignId);
  return { leads: slugs.length };
}

/**
 * Kampagne duplizieren: Vorlage, Einstellungen, Follow-ups und Varianten (inkl. aktiv-Status) werden kopiert,
 * Leads nicht. Untersequenz-Regeln werden bewusst NICHT kopiert (das Ziel wäre unklar, und eine Regel in die
 * Original-Kampagne würde ungewollt Leads weiterleiten). Die Kopie heißt „<Name> (Kopie)“ und startet als Entwurf. Gibt die neue Kampagne zurück.
 */
export function dupliziereKampagne(campaignId: number): typeof schema.campaigns.$inferSelect | null {
  const db = getDb();
  return db.transaction((tx) => {
    const quelle = tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
    if (!quelle) return null;
    const einstellungen: Partial<typeof quelle> = { ...quelle };
    delete einstellungen.id;
    delete einstellungen.createdAt;
    const [kopie] = tx
      .insert(schema.campaigns)
      .values({ ...(einstellungen as Omit<typeof quelle, 'id' | 'createdAt'>), name: `${quelle.name} (Kopie)`.slice(0, 220), status: 'entwurf', pausiertGrund: null, abAutoLog: null })
      .returning()
      .all();
    const followups = tx.select().from(schema.followups).where(eq(schema.followups.campaignId, campaignId)).orderBy(schema.followups.position).all();
    const followupMap = new Map<number, number>();
    for (const f of followups) {
      const neu = tx.insert(schema.followups).values({ campaignId: kopie.id, position: f.position, waitDays: f.waitDays, body: f.body, betreff: f.betreff }).returning().get();
      const fv = tx.select().from(schema.followupVarianten).where(eq(schema.followupVarianten.followupId, f.id)).orderBy(schema.followupVarianten.kuerzel).all();
      for (const v of fv) tx.insert(schema.followupVarianten).values({ followupId: neu.id, kuerzel: v.kuerzel, text: v.text, betreff: v.betreff, aktiv: v.aktiv, verhalten: v.verhalten }).run();
      followupMap.set(f.id, neu.id);
    }
    // Anhänge (Erstmail + Follow-ups) mitkopieren, Erstmail-Anhänge haben followupId null
    kopiereAnhaenge(campaignId, kopie.id, followupMap);
    const varianten = tx.select().from(schema.varianten).where(eq(schema.varianten.campaignId, campaignId)).orderBy(schema.varianten.id).all();
    for (const v of varianten) tx.insert(schema.varianten).values({ campaignId: kopie.id, kuerzel: v.kuerzel, betreff: v.betreff, text: v.text, aktiv: v.aktiv }).run();
    return kopie;
  });
}

export const FIRMEN_DUPLIKAT = 'Firmen-Duplikat';

/** Reihenfolge, in der je Firma der „behaltene“ Kontakt gewählt wird: bereits angeschriebene zuerst, dann nach Import. */
export function duplikatReihenfolge<T extends { id: number; sendStatus: string }>(leads: T[]): T[] {
  return [...leads].sort((a, b) => (a.sendStatus === 'gesendet' ? 0 : 1) - (b.sendStatus === 'gesendet' ? 0 : 1) || a.id - b.id);
}

/**
 * Weitere Kontakte derselben Firma vom Versand ausschließen (Status „übersprungen“, Grund „Firmen-Duplikat“)
 * und aus der Render-Warteschlange nehmen. Bereits gesendete Leads bleiben unverändert.
 */
export function schliesseFirmenDuplikateAus(campaignId: number): number {
  const db = getDb();
  const leads = db
    .select({ id: schema.leads.id, firma: schema.leads.firma, sendStatus: schema.leads.sendStatus })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, campaignId))
    .all();
  const duplikate = firmenDuplikate(duplikatReihenfolge(leads));
  const ids = leads.filter((l) => duplikate.has(l.id) && ['nicht_gesendet', 'geplant', 'fehler'].includes(l.sendStatus)).map((l) => l.id);
  if (ids.length === 0) return 0;
  db.update(schema.leads)
    .set({ sendStatus: 'uebersprungen', sendError: FIRMEN_DUPLIKAT, renderRequested: false })
    .where(inArray(schema.leads.id, ids))
    .run();
  schliesseKampagneAb(campaignId);
  return ids.length;
}

/** Ausschluss der Firmen-Duplikate aufheben (sie werden wieder normal versendet). */
export function hebeFirmenDuplikateAuf(campaignId: number): number {
  return getDb()
    .update(schema.leads)
    .set({ sendStatus: 'nicht_gesendet', sendError: null })
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.leads.sendStatus, 'uebersprungen'), eq(schema.leads.sendError, FIRMEN_DUPLIKAT)))
    .run().changes;
}

export const KAMPAGNEN_STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf',
  rendert: 'Rendert',
  bereit: 'Bereit',
  versendet_laufend: 'Versand läuft',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen',
};

/**
 * Kontext für die Import-Prüfung. Jede Kampagne steht für sich: Duplikate (E-Mail, Firma) zählen nur innerhalb
 * der Ziel-Kampagne. Nur die Sperrliste (Abmeldungen) gilt kampagnenübergreifend.
 */
export function ladeImportKontext(campaignId: number) {
  const db = getDb();
  const vorhanden = db.select({ email: schema.leads.email, firma: schema.leads.firma }).from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).all();
  const gesperrt = db.select({ email: schema.suppressionList.email }).from(schema.suppressionList).all();
  return {
    existingEmails: new Set(vorhanden.map((r) => r.email.toLowerCase())),
    suppressed: new Set(gesperrt.map((r) => r.email.toLowerCase())),
    existingFirmen: new Set(vorhanden.map((r) => firmenSchluessel(r.firma))),
  };
}

export type KampagnenKennzahlen = {
  id: number;
  leads: number;
  gerendert: number;
  gesendet: number;
  seitenaufrufe: number;
  videostarts: number;
  /** Ø max. Fortschritt in % der Leads mit Play, null wenn keine */
  sehdauer: number | null;
  terminKlicks: number;
  abmeldungen: number;
  antworten: number;
};

/** Kennzahlen je Kampagne (Nicht-Bot-Events) */
export function ladeKennzahlen(): Map<number, KampagnenKennzahlen> {
  const db = getDb();
  const map = new Map<number, KampagnenKennzahlen>();
  const get = (id: number) => {
    let k = map.get(id);
    if (!k) {
      k = { id, leads: 0, gerendert: 0, gesendet: 0, seitenaufrufe: 0, videostarts: 0, sehdauer: null, terminKlicks: 0, abmeldungen: 0, antworten: 0 };
      map.set(id, k);
    }
    return k;
  };

  const leadRows = db
    .select({
      id: schema.leads.campaignId,
      leads: sql<number>`count(*)`,
      gerendert: sql<number>`sum(case when ${schema.leads.renderStatus} = 'fertig' then 1 else 0 end)`,
      gesendet: sql<number>`sum(case when ${schema.leads.sendStatus} = 'gesendet' then 1 else 0 end)`,
      abmeldungen: sql<number>`sum(case when ${schema.leads.unsubscribed} = 1 then 1 else 0 end)`,
      antworten: sql<number>`sum(case when ${schema.leads.flowStopp} = 'beantwortet' then 1 else 0 end)`,
    })
    .from(schema.leads)
    .groupBy(schema.leads.campaignId)
    .all();
  for (const r of leadRows)
    Object.assign(get(r.id), { leads: r.leads, gerendert: r.gerendert ?? 0, gesendet: r.gesendet ?? 0, abmeldungen: r.abmeldungen ?? 0, antworten: r.antworten ?? 0 });

  const eventRows = db
    .select({
      id: schema.leads.campaignId,
      views: sql<number>`sum(case when ${schema.events.type} = 'page_view' then 1 else 0 end)`,
      plays: sql<number>`sum(case when ${schema.events.type} = 'play' then 1 else 0 end)`,
      klicks: sql<number>`sum(case when ${schema.events.type} = 'cta_click' then 1 else 0 end)`,
    })
    .from(schema.events)
    .innerJoin(schema.leads, sql`${schema.events.leadId} = ${schema.leads.id}`)
    .where(sql`${schema.events.isBot} = 0`)
    .groupBy(schema.leads.campaignId)
    .all();
  for (const r of eventRows) Object.assign(get(r.id), { seitenaufrufe: r.views ?? 0, videostarts: r.plays ?? 0, terminKlicks: r.klicks ?? 0 });

  // Ø max. Fortschritt je Lead mit Play
  const sehRows = db
    .select({
      id: schema.leads.campaignId,
      avg: sql<number>`avg(m.max_p)`,
    })
    .from(schema.leads)
    .innerJoin(
      sql`(select lead_id, max(case type when 'progress_100' then 100 when 'progress_75' then 75 when 'progress_50' then 50 when 'progress_25' then 25 else 0 end) as max_p from events where is_bot = 0 group by lead_id having sum(case when type = 'play' then 1 else 0 end) > 0) as m`,
      sql`m.lead_id = ${schema.leads.id}`,
    )
    .groupBy(schema.leads.campaignId)
    .all();
  for (const r of sehRows) get(r.id).sehdauer = r.avg === null ? null : Math.round(r.avg);

  return map;
}

// ---------------------------------------------------------------- Extra-Spalten (Vorlagen-Variablen)

/** Alle normalisierten Extra-Spaltennamen der Leads einer Kampagne (sortiert). */
export function kampagnenExtraSpalten(campaignId: number): string[] {
  const zeilen = getDb().select({ extra: schema.leads.extra }).from(schema.leads).where(eq(schema.leads.campaignId, campaignId)).all();
  const namen = new Set<string>();
  for (const z of zeilen) for (const spalte of Object.keys(z.extra ?? {})) {
    const k = normalisiereSpaltenname(spalte);
    if (k) namen.add(k);
  }
  return [...namen].sort();
}
