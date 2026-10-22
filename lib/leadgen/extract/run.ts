import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { ladeSeitenText } from '../web';
import type { LeadgenDeps } from '../deps';
import { normalisiereRolle } from '../normalize/person';
import { normalisiereTelefon } from '../normalize/telefon';
import { ordnePersonAufFirma } from '../resolve/resolve';
import { wzZuBranche } from './branche';
import { extrahiereEmails, extrahiereMitarbeiter, extrahiereRegister, extrahiereTelefone, extrahiereUstId } from './deterministic';
import { emailImText, groundingKontext, nameImText, rolleImText, telefonImText, zitatImText } from './grounding';
import { ExtraktionFehler } from './provider';
import { BRANCHEN_SCHEMA, PERSONEN_SCHEMA } from './schemas';

// Stufe 5: Extraktion aus bereits gecrawlten Seiten (kein Netzzugriff auf die Firma, also ohne Neu-Crawl wiederholbar).
// Zuerst deterministisch (E-Mail, Telefon, Registernummer, USt-IdNr), danach nur für die Zuordnung das LLM. Jeder Wert des LLM
// wird gegen den Quelltext geprüft (Grounding) und sonst verworfen.

export type ExtraktionsErgebnis = { runId: number; seiten: number; personen: number; emails: number; telefone: number; verworfen: number; branche: string | null };

const QUELLE = 'web';
const KONFIDENZ = { deterministisch: 0.9, zugeordnet: 0.75, branche: 0.9 };
const LLM_SEITENARTEN = new Set(['impressum', 'kontakt', 'team']);
const MAX_SEITEN = 8;

export async function extrahiereFirma(companyId: number, deps: Pick<LeadgenDeps, 'extraktion' | 'runId'>, db: Db = getDb()): Promise<ExtraktionsErgebnis> {
  const seiten = db
    .select()
    .from(schema.crawlPages)
    .where(and(eq(schema.crawlPages.companyId, companyId), eq(schema.crawlPages.status, 'ok'), isNotNull(schema.crawlPages.rawDocumentId)))
    .orderBy(schema.crawlPages.id)
    .all()
    .slice(0, MAX_SEITEN);
  if (!seiten.length) throw new ExtraktionFehler('Keine gecrawlten Seiten vorhanden: erst das Crawling ausführen.');

  const run = db.insert(schema.extractionRuns).values({ companyId, provider: deps.extraktion.name, modell: deps.extraktion.modell, seiten: seiten.length }).returning({ id: schema.extractionRuns.id }).get();
  const erg: ExtraktionsErgebnis = { runId: run.id, seiten: seiten.length, personen: 0, emails: 0, telefone: 0, verworfen: 0, branche: null };
  const obs = (b: { entityType: 'company' | 'person'; entityId: number; feld: string; wert: unknown; konfidenz: number; rawDocumentId: number; typ?: 'exakt' | 'klasse' | 'schaetzung' }) =>
    db.insert(schema.attributeObservations).values({ ...b, quelle: QUELLE, extraktionRunId: run.id }).run();
  const bereitsEmail = new Set<string>();
  const bereitsTelefon = new Set<string>();
  let mitarbeiterGefunden = false;

  let startText = '';
  for (const seite of seiten) {
    const rawId = seite.rawDocumentId!;
    const text = ladeSeitenText(rawId, db);
    if (seite.art === 'start') startText = text;
    if (text.length < 20) continue;
    const ctx = groundingKontext(text);

    // 1. Deterministisch
    const emails = extrahiereEmails(text);
    const telefone = extrahiereTelefone(text);
    for (const mail of emails) {
      if (bereitsEmail.has(mail)) continue;
      bereitsEmail.add(mail);
      obs({ entityType: 'company', entityId: companyId, feld: 'email', wert: { adresse: mail, zuordnung: 'unbekannt', url: seite.url }, konfidenz: KONFIDENZ.deterministisch, rawDocumentId: rawId });
      erg.emails++;
    }
    const artVon = new Map(telefone.map((t) => [t.e164, t.art]));
    for (const t of telefone) {
      if (bereitsTelefon.has(t.e164)) continue;
      bereitsTelefon.add(t.e164);
      obs({ entityType: 'company', entityId: companyId, feld: 'telefon', wert: { e164: t.e164, national: t.national, typ: t.typ, art: t.art, url: seite.url }, konfidenz: KONFIDENZ.deterministisch, rawDocumentId: rawId });
      erg.telefone++;
    }
    if (!mitarbeiterGefunden) {
      const ma = extrahiereMitarbeiter(text);
      if (ma) {
        // Selbstauskunft der Webseite: nie exakt, höchstens eine Schätzung
        obs({ entityType: 'company', entityId: companyId, feld: 'mitarbeiter', wert: { zahl: ma.zahl, ungefaehr: ma.ungefaehr, url: seite.url }, konfidenz: 0.5, rawDocumentId: rawId, typ: 'schaetzung' });
        mitarbeiterGefunden = true;
      }
    }
    if (seite.art === 'impressum' || seite.art === 'kontakt') {
      const ust = extrahiereUstId(text);
      if (ust) obs({ entityType: 'company', entityId: companyId, feld: 'ust_idnr', wert: ust, konfidenz: KONFIDENZ.deterministisch, rawDocumentId: rawId });
      const reg = extrahiereRegister(text);
      if (reg?.nummer) {
        obs({ entityType: 'company', entityId: companyId, feld: 'registernummer', wert: reg.nummer, konfidenz: KONFIDENZ.deterministisch, rawDocumentId: rawId });
        if (reg.art) obs({ entityType: 'company', entityId: companyId, feld: 'registerart', wert: reg.art, konfidenz: KONFIDENZ.deterministisch, rawDocumentId: rawId });
        if (reg.gericht) obs({ entityType: 'company', entityId: companyId, feld: 'registergericht', wert: reg.gericht, konfidenz: KONFIDENZ.deterministisch, rawDocumentId: rawId });
      }
    }

    // 2. LLM nur für die Zuordnung, danach Grounding
    if (!LLM_SEITENARTEN.has(seite.art)) continue;
    const hinweis = [
      emails.length ? `Gefundene E-Mail-Adressen: ${emails.join(', ')}` : '',
      telefone.length ? `Gefundene Telefonnummern: ${telefone.map((t) => `${t.national} (davor: „${t.kontext}“)`).join('; ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const antwort = await deps.extraktion.extract(`${hinweis}\n\n---\n${text}`, PERSONEN_SCHEMA);

    // Die Art einer Nummer (Zentrale, Durchwahl, Mobil, Fax) nimmt das LLM aus dem Umfeld; nur belegte Nummern, und nur wo die
    // deterministische Erkennung keine Art ermitteln konnte
    for (const t of antwort.telefone) {
      const nr = normalisiereTelefon(t.nummer);
      if (!nr || !telefonImText(ctx, t.nummer)) {
        erg.verworfen++;
        continue;
      }
      if (t.art !== 'unbekannt' && artVon.get(nr.e164) === 'unbekannt') {
        obs({ entityType: 'company', entityId: companyId, feld: 'telefon', wert: { e164: nr.e164, national: nr.national, typ: nr.typ, art: t.art, url: seite.url }, konfidenz: KONFIDENZ.zugeordnet, rawDocumentId: rawId });
      }
    }
    for (const p of antwort.personen) {
      // Name und Rolle müssen im Text stehen; eine erfundene oder umformulierte Rolle (v. a. „Geschäftsführer“) wäre gefährlich
      if (!p.nachname.trim() || !nameImText(ctx, p.vorname, p.nachname) || !rolleImText(ctx, p.rolle)) {
        erg.verworfen++;
        continue;
      }
      const z = ordnePersonAufFirma(db, companyId, { vorname: p.vorname?.trim() || null, nachname: p.nachname.trim() }, QUELLE, seite.url);
      // Gelöschte (gesperrte) Personen werden nicht wieder aufgenommen
      if (!z) continue;
      obs({
        entityType: 'person',
        entityId: z.personId,
        feld: 'person',
        wert: { vorname: p.vorname?.trim() || null, nachname: p.nachname.trim(), titel: [], rolle: normalisiereRolle(p.rolle), rolleOriginal: p.rolle.trim(), url: seite.url },
        konfidenz: KONFIDENZ.zugeordnet,
        rawDocumentId: rawId,
      });
      erg.personen++;
      if (p.email) {
        if (emailImText(ctx, p.email)) obs({ entityType: 'person', entityId: z.personId, feld: 'email', wert: { adresse: p.email.toLowerCase().trim(), zuordnung: 'person', url: seite.url }, konfidenz: KONFIDENZ.zugeordnet, rawDocumentId: rawId });
        else erg.verworfen++;
      }
      if (p.telefon) {
        const nr = normalisiereTelefon(p.telefon);
        if (!nr || !telefonImText(ctx, p.telefon)) erg.verworfen++;
        // Ein Fax ist nie die Durchwahl einer Person
        else if (artVon.get(nr.e164) !== 'fax') obs({ entityType: 'person', entityId: z.personId, feld: 'telefon', wert: { e164: nr.e164, national: nr.national, typ: nr.typ, art: p.telefonArt ?? 'unbekannt', url: seite.url }, konfidenz: KONFIDENZ.zugeordnet, rawDocumentId: rawId });
      }
    }
  }

  // 3. Branche: WZ-Code (falls bekannt) und LLM-Klassifikation der Webseite mit belegtem Zitat
  const wz = db.select().from(schema.attributeObservations).where(and(eq(schema.attributeObservations.entityType, 'company'), eq(schema.attributeObservations.entityId, companyId), eq(schema.attributeObservations.feld, 'wz'))).get();
  const ausWz = wzZuBranche(typeof wz?.wert === 'string' ? wz.wert : null);
  if (ausWz && wz) db.insert(schema.attributeObservations).values({ entityType: 'company', entityId: companyId, feld: 'branche_wz', wert: { branche: ausWz.branche, wz: wz.wert }, quelle: wz.quelle, rawDocumentId: wz.rawDocumentId, konfidenz: ausWz.konfidenz, extraktionRunId: run.id }).run();
  const startSeite = seiten.find((s) => s.art === 'start');
  if (startText.length >= 50 && startSeite) {
    const b = await deps.extraktion.extract(startText, BRANCHEN_SCHEMA);
    if (zitatImText(groundingKontext(startText), b.beleg)) {
      obs({ entityType: 'company', entityId: companyId, feld: 'branche_web', wert: { branche: b.branche, konfidenz: b.konfidenz, beleg: b.beleg }, konfidenz: Math.min(b.konfidenz, KONFIDENZ.branche), rawDocumentId: startSeite.rawDocumentId! });
      erg.branche = b.branche;
    } else erg.verworfen++;
  }

  db.update(schema.extractionRuns).set({ verworfen: erg.verworfen }).where(eq(schema.extractionRuns.id, run.id)).run();
  return erg;
}
