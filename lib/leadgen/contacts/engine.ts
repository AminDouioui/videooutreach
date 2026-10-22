import { and, eq, lte } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { KONTAKT_SCHWELLEN, ROLLE_OFFEN_WIEDERHOLUNG_TAGE } from '../config';
import { STANDARD_SCHRITTE, type ContactStep, type KontaktDeps, type KontaktKontext, type KontaktTreffer } from './steps';
import { uebernehmeTelefone } from './telefon';

// Stufe 6: Kontakt-Engine. Eingabe: Firma plus Zielrolle (z. B. „einkauf_leitung“). Ausgabe: verifizierte E-Mail der Person in dieser
// Rolle mit Herkunft und Konfidenz. Die Engine führt die Kette der Schritte aus, bis ein Ergebnis mit ausreichender Konfidenz vorliegt,
// und speichert alles als Beobachtungen (nichts geht verloren, der Golden Record bleibt neu berechenbar).

export type KontaktErgebnis = {
  status: 'gefunden' | 'rolle_offen' | 'keine_domain' | 'fehler';
  personId: number | null;
  person: { vorname: string | null; nachname: string; rolle: string } | null;
  rollenTreffer: string | null;
  treffer: KontaktTreffer | null;
  quellen: string[];
  protokoll: string[];
  fehler: string[];
};

export async function fuehreKontaktEngineAus(
  companyId: number,
  rolleKey: string,
  deps: KontaktDeps,
  opt: { db?: Db; schritte?: ContactStep[] } = {},
): Promise<KontaktErgebnis> {
  const db = opt.db ?? getDb();
  const jetzt = deps.jetzt ?? Date.now;
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!c) throw new Error(`Firma ${companyId} existiert nicht.`);
  const rolle = deps.rollen.rolle(rolleKey);
  if (!rolle) throw new Error(`Unbekannte Zielrolle: ${rolleKey}`);

  const ctx: KontaktKontext = {
    db,
    firma: { id: c.id, name: c.name, nameNormalized: c.nameNormalized, ort: c.ort, domain: c.domain },
    rolleKey,
    rolle,
    deps,
    treffer: [],
    person: null,
    personId: null,
    muster: [],
    bekannteAdressen: [],
    kandidaten: [],
    naechsteKandidat: 0,
    pruefungen: [],
    domain: null,
    catchAll: false,
    ergebnis: null,
    fertig: false,
    protokoll: [],
    fehler: [],
  };

  if (!c.domain) {
    ctx.protokoll.push('Keine bestätigte Domain: erst die Domain-Ermittlung ausführen');
    return speichere(ctx, 'keine_domain', jetzt());
  }

  for (const schritt of opt.schritte ?? STANDARD_SCHRITTE) {
    // Die Kette endet, sobald ein Ergebnis mit ausreichender Konfidenz vorliegt
    if (ctx.ergebnis && ctx.ergebnis.konfidenz >= KONTAKT_SCHWELLEN.ausreichend) break;
    if (ctx.fertig && schritt.name.startsWith('E')) break;
    try {
      await schritt.run(ctx);
    } catch (e) {
      ctx.fehler.push(`${schritt.name}: ${e instanceof Error ? e.message : String(e)}`);
      ctx.protokoll.push(`${schritt.name}: Fehler (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  // Ein Schritt-Fehler ohne Ergebnis soll als Fehler sichtbar werden (Queue wiederholt mit Backoff), nicht als „Rolle offen“
  if (!ctx.ergebnis && !ctx.person && ctx.fehler.length) return speichere(ctx, 'fehler', jetzt());
  return speichere(ctx, ctx.person ? 'gefunden' : 'rolle_offen', jetzt());
}

function speichere(ctx: KontaktKontext, status: KontaktErgebnis['status'], jetzt: number): KontaktErgebnis {
  const { db, firma, rolleKey } = ctx;
  const t = ctx.ergebnis;
  const quellen = [...new Set((ctx.person?.quellen ?? []).map((q) => q.url).filter((u): u is string => !!u))];
  let contactPointId: number | null = null;
  db.transaction((tx) => {
    const txd = tx as unknown as Db;
    if (t) {
      const herkunft = { quellen, muster: t.muster, musterKonfidenz: t.musterKonfidenz, rollenTreffer: ctx.person?.rollenTreffer ?? null, rolle: ctx.person?.rolleText ?? null, verifier: ctx.deps.verifier.name };
      const cp = txd
        .insert(schema.contactPoints)
        .values({ companyId: firma.id, personId: ctx.personId, typ: 'email', wert: t.email, status: t.status, rolleKey, muster: t.muster, konfidenz: t.konfidenz, herkunft, verifiziertAm: t.verifiziertAm ? new Date(t.verifiziertAm) : null })
        .onConflictDoUpdate({
          target: [schema.contactPoints.companyId, schema.contactPoints.typ, schema.contactPoints.wert],
          set: { personId: ctx.personId, status: t.status, rolleKey, muster: t.muster, konfidenz: t.konfidenz, herkunft, verifiziertAm: t.verifiziertAm ? new Date(t.verifiziertAm) : null, updatedAt: new Date(jetzt) },
        })
        .returning({ id: schema.contactPoints.id })
        .get();
      contactPointId = cp.id;
      // Ergebnis als Beobachtung: Person, Rolle, E-Mail, Status, Muster-Herkunft, Gesamt-Konfidenz, Quellen
      txd.insert(schema.attributeObservations)
        .values({
          entityType: 'contact_point',
          entityId: cp.id,
          feld: 'email',
          wert: { adresse: t.email, status: t.status, personId: ctx.personId, rolleKey, rolle: ctx.person?.rolleText ?? null, rollenTreffer: ctx.person?.rollenTreffer ?? null, muster: t.muster, musterKonfidenz: t.musterKonfidenz, quellen },
          quelle: 'kontakt-engine',
          konfidenz: t.konfidenz,
          typ: 'exakt',
          beobachtetAm: new Date(jetzt),
        })
        .run();
    }
    // Alle Verifizierungsergebnisse (auch ungültige) als Beobachtungen, damit nichts verloren geht
    for (const p of ctx.pruefungen) {
      txd.insert(schema.attributeObservations)
        .values({ entityType: 'contact_point', entityId: contactPointId, feld: 'email_pruefung', wert: { adresse: p.adresse, status: p.status, ausCache: p.ausCache, details: p.details ?? null }, quelle: `verifier:${ctx.deps.verifier.name}`, konfidenz: p.status === 'gueltig' ? 0.97 : 0.5, beobachtetAm: new Date(jetzt) })
        .run();
    }
    const alt = txd.select().from(schema.kontaktErgebnisse).where(and(eq(schema.kontaktErgebnisse.companyId, firma.id), eq(schema.kontaktErgebnisse.rolleKey, rolleKey))).get();
    // „Rolle offen“ oder keine E-Mail: erneute Anreicherung einplanen
    const nochOffen = status === 'rolle_offen' || (status === 'gefunden' && !t);
    const werte = {
      status,
      personId: ctx.personId,
      contactPointId,
      rollenTreffer: ctx.person?.rollenTreffer ?? null,
      konfidenz: t?.konfidenz ?? ctx.person?.personKonfidenz ?? 0,
      details: { protokoll: ctx.protokoll, fehler: ctx.fehler, quellen, status: t?.status ?? null },
      versuche: (alt?.versuche ?? 0) + 1,
      naechsteAnreicherungAt: nochOffen ? new Date(jetzt + ROLLE_OFFEN_WIEDERHOLUNG_TAGE * 86400_000) : null,
      updatedAt: new Date(jetzt),
    };
    txd.insert(schema.kontaktErgebnisse).values({ companyId: firma.id, rolleKey, ...werte }).onConflictDoUpdate({ target: [schema.kontaktErgebnisse.companyId, schema.kontaktErgebnisse.rolleKey], set: werte }).run();
    uebernehmeTelefone(firma.id, txd);
  });
  return {
    status,
    personId: ctx.personId,
    person: ctx.person ? { vorname: ctx.person.vorname, nachname: ctx.person.nachname, rolle: ctx.person.rolleText } : null,
    rollenTreffer: ctx.person?.rollenTreffer ?? null,
    treffer: t,
    quellen,
    protokoll: ctx.protokoll,
    fehler: ctx.fehler,
  };
}

/** Firmen, deren Zielrolle offen blieb und die jetzt erneut angereichert werden sollen. */
export function faelligeWiederholungen(jetzt = Date.now(), db: Db = getDb()) {
  return db
    .select({ companyId: schema.kontaktErgebnisse.companyId, rolleKey: schema.kontaktErgebnisse.rolleKey })
    .from(schema.kontaktErgebnisse)
    .where(and(eq(schema.kontaktErgebnisse.status, 'rolle_offen'), lte(schema.kontaktErgebnisse.naechsteAnreicherungAt, new Date(jetzt))))
    .all();
}
