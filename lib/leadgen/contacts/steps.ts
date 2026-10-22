import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/lib/db';
import { extrahiereEmails } from '../extract/deterministic';
import { ALLGEMEINE_GENERISCHE, GENERISCHE_FUER_ROLLE, KONTAKT_SCHWELLEN, STANDARD_SUCHVORLAGEN, type RollenDefinition, type Suchvorlage } from '../config';
import type { LeadgenDeps } from '../deps';
import { ordnePersonAufFirma } from '../resolve/resolve';
import { normalisiereRolle } from '../normalize/person';
import { fuehreTrefferZusammen, SucheFinder, waehlePerson, WebsiteFinder, type FirmaKontext, type GewaehltePerson, type PersonenFinder, type PersonTreffer } from './finder';
import { bildeKandidaten, istGenerischesPostfach, musterKonfidenzen, zaehleBelege, zerlegeAdresse, type AdressKandidat, type MusterKonfidenz } from './muster';
import type { Rollenverzeichnis } from './rollen';
import type { DomainEigenschaften, GedrosselterVerifier, GeprueftEintrag } from './verifier';

// Die Kette der Schritte A bis E. Jeder Schritt ist ein eigenes Modul mit demselben Interface (`ContactStep`), die Reihenfolge ist
// in der Engine konfigurierbar. Gemeinsamer Zustand ist der KontaktKontext; die Kette endet, sobald ein Ergebnis mit ausreichender
// Konfidenz vorliegt.

export type KontaktDeps = Pick<LeadgenDeps, 'suche' | 'fetcher' | 'extraktion' | 'runId'> & {
  verifier: GedrosselterVerifier;
  rollen: Rollenverzeichnis;
  finder?: PersonenFinder[];
  suchvorlagen?: Suchvorlage[];
  jetzt?: () => number;
};

export type EmailStatus = 'gueltig' | 'catch_all_best_guess' | 'generisch' | 'generisch_unverifiziert';

export type KontaktTreffer = {
  email: string;
  status: EmailStatus;
  muster: string | null;
  musterKonfidenz: number | null;
  /** Gesamt-Konfidenz des Leads: Person (inkl. Rollen-Passung) × E-Mail-Verlässlichkeit */
  konfidenz: number;
  verifiziertAm: number | null;
};

export type KontaktKontext = {
  db: Db;
  firma: FirmaKontext;
  rolleKey: string;
  rolle: RollenDefinition;
  deps: KontaktDeps;
  treffer: PersonTreffer[];
  person: GewaehltePerson | null;
  personId: number | null;
  muster: MusterKonfidenz[];
  bekannteAdressen: string[];
  kandidaten: AdressKandidat[];
  naechsteKandidat: number;
  pruefungen: GeprueftEintrag[];
  domain: DomainEigenschaften | null;
  catchAll: boolean;
  ergebnis: KontaktTreffer | null;
  fertig: boolean;
  /** Nachvollziehbares Protokoll der Schritte (landet in den Details des Ergebnisses) */
  protokoll: string[];
  fehler: string[];
};

export interface ContactStep {
  readonly name: string;
  run(ctx: KontaktKontext): Promise<void>;
}

const jetztMs = (ctx: KontaktKontext) => (ctx.deps.jetzt ?? Date.now)();

// ---------------------------------------------------------------- Schritt A

export const personFinden: ContactStep = {
  name: 'A:person-finden',
  async run(ctx) {
    const finder = ctx.deps.finder ?? [new WebsiteFinder(), new SucheFinder(ctx.deps.suchvorlagen ?? STANDARD_SUCHVORLAGEN)];
    const fk = { firma: ctx.firma, rolleKey: ctx.rolleKey, rollen: ctx.deps.rollen, deps: ctx.deps, db: ctx.db, jetzt: jetztMs(ctx) };
    // Alle Finder parallel; ein ausgefallener Finder verhindert die anderen nicht
    const ergebnisse = await Promise.allSettled(finder.map((f) => f.finde(fk)));
    ergebnisse.forEach((r, i) => {
      if (r.status === 'fulfilled') ctx.treffer.push(...r.value);
      else ctx.fehler.push(`${finder[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    });
    ctx.protokoll.push(`A: ${ctx.treffer.length} Treffer aus ${finder.length} Findern`);
    // Nur Rollen, die zur Zielrolle oder deren Fallback passen, kommen in Frage (Register-Treffer enthalten z. B. auch Prokuristen)
    const relevant = ctx.treffer.filter((t) => ctx.deps.rollen.vergleiche(ctx.rolleKey, t.rolle).treffer !== 'keiner');
    ctx.person = waehlePerson(fuehreTrefferZusammen(relevant), ctx.rolleKey, ctx.deps.rollen);
    if (!ctx.person) {
      ctx.protokoll.push('A: keine Person zur Rolle gefunden');
      return;
    }
    ctx.protokoll.push(`A: ${ctx.person.vorname ?? ''} ${ctx.person.nachname} (${ctx.person.rolleText}, ${ctx.person.rollenTreffer}, Konfidenz ${ctx.person.personKonfidenz.toFixed(2)})`);
    // Die Person bekommt eine stabile person_id; Fundstellen aus der Suche werden als Beobachtungen gespeichert
    const p = ctx.person;
    ctx.personId = ordnePersonAufFirma(ctx.db, ctx.firma.id, { vorname: p.vorname, nachname: p.nachname }, 'kontakt-engine', `${ctx.rolleKey}`).personId;
    for (const q of p.quellen.filter((x) => x.typ !== 'website' && x.typ !== 'register')) {
      ctx.db
        .insert(schema.attributeObservations)
        .values({
          entityType: 'person',
          entityId: ctx.personId,
          feld: 'person',
          wert: { vorname: p.vorname, nachname: p.nachname, titel: [], rolle: normalisiereRolle(p.rolleText), rolleOriginal: p.rolleText, url: q.url },
          quelle: `suche:${q.typ}`,
          konfidenz: q.konfidenz,
        })
        .run();
    }
  },
};

// ---------------------------------------------------------------- Schritt B

/** Bekannte Adressen der Domain: Beobachtungen aus Impressum/Website, verifizierte Kontakte, Websuche nach „@domain“. */
async function sammleBekannteAdressen(ctx: KontaktKontext, domain: string): Promise<Array<{ adresse: string; person: { vorname: string | null; nachname: string } | null }>> {
  const personen = ctx.db.select().from(schema.persons).where(eq(schema.persons.companyId, ctx.firma.id)).all();
  const nachId = new Map(personen.map((p) => [p.id, p]));
  const adressen = new Map<string, { vorname: string | null; nachname: string } | null>();
  const merke = (adresse: string, person: { vorname: string | null; nachname: string } | null) => {
    const z = zerlegeAdresse(adresse);
    if (!z || z.domain !== domain) return;
    const alt = adressen.get(z.local + '@' + z.domain);
    if (!alt) adressen.set(z.local + '@' + z.domain, person);
  };
  const personenIds = personen.map((p) => p.id);
  const beobachtungen = [
    ...ctx.db.select().from(schema.attributeObservations).where(and(eq(schema.attributeObservations.feld, 'email'), eq(schema.attributeObservations.entityType, 'company'), eq(schema.attributeObservations.entityId, ctx.firma.id))).all(),
    ...(personenIds.length ? ctx.db.select().from(schema.attributeObservations).where(and(eq(schema.attributeObservations.feld, 'email'), eq(schema.attributeObservations.entityType, 'person'), inArray(schema.attributeObservations.entityId, personenIds))).all() : []),
  ];
  for (const o of beobachtungen) {
    const w = o.wert as { adresse?: string };
    if (!w.adresse) continue;
    if (o.entityType === 'person' && o.entityId && nachId.has(o.entityId)) merke(w.adresse, nachId.get(o.entityId)!);
    else merke(w.adresse, null);
  }
  for (const c of ctx.db.select().from(schema.contactPoints).where(eq(schema.contactPoints.companyId, ctx.firma.id)).all()) {
    if (c.typ === 'email' && c.status === 'gueltig') merke(c.wert, c.personId ? (nachId.get(c.personId) ?? null) : null);
  }
  // Websuche nach „@domain“: nur Adressen dieser Domain aus Titel und Snippet
  try {
    for (const t of await ctx.deps.suche.suche(`"@${domain}"`, { anzahl: 10 })) for (const m of extrahiereEmails(`${t.titel} ${t.snippet}`)) merke(m, null);
  } catch (e) {
    ctx.fehler.push(`Suche @${domain}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Adressen ohne zugeordneten Namen den bekannten Personen zuordnen, soweit sie zu deren Namen passen
  const bekanntePersonen = [...personen.map((p) => ({ vorname: p.vorname, nachname: p.nachname })), ...(ctx.person ? [{ vorname: ctx.person.vorname, nachname: ctx.person.nachname }] : [])];
  return [...adressen.entries()].map(([adresse, person]) => ({ adresse, person: person ?? bekanntePersonen.find((p) => zaehleBelege([{ adresse, person: p }]).size > 0) ?? null }));
}

export const musterBestimmen: ContactStep = {
  name: 'B:muster-bestimmen',
  async run(ctx) {
    const domain = ctx.firma.domain;
    if (!domain) return;
    const gesammelt = await sammleBekannteAdressen(ctx, domain);
    ctx.bekannteAdressen = gesammelt.map((g) => g.adresse);
    const belege = zaehleBelege(gesammelt.filter((g): g is { adresse: string; person: { vorname: string | null; nachname: string } } => !!g.person));
    // Frühere Läufe: gespeicherte Belege nicht verlieren (der höhere Wert gilt)
    for (const z of ctx.db.select().from(schema.domainEmailPatterns).where(eq(schema.domainEmailPatterns.domain, domain)).all()) belege.set(z.muster, Math.max(belege.get(z.muster) ?? 0, z.belege));
    for (const [muster, n] of belege) {
      ctx.db
        .insert(schema.domainEmailPatterns)
        .values({ domain, muster, belege: n, aktualisiertAm: new Date(jetztMs(ctx)) })
        .onConflictDoUpdate({ target: [schema.domainEmailPatterns.domain, schema.domainEmailPatterns.muster], set: { belege: n, aktualisiertAm: new Date(jetztMs(ctx)) } })
        .run();
    }
    ctx.muster = musterKonfidenzen(belege);
    const primaer = ctx.muster[0];
    ctx.protokoll.push(`B: ${ctx.bekannteAdressen.length} bekannte Adressen, primäres Muster ${primaer.muster} (${primaer.belege > 0 ? `${primaer.belege} Belege` : 'Standard-Prior'}, Konfidenz ${primaer.konfidenz.toFixed(2)})`);
  },
};

// ---------------------------------------------------------------- Schritt C

export const kandidatenBilden: ContactStep = {
  name: 'C:kandidaten-bilden',
  async run(ctx) {
    if (!ctx.person || !ctx.firma.domain) return;
    ctx.kandidaten = bildeKandidaten({ vorname: ctx.person.vorname, nachname: ctx.person.nachname }, ctx.firma.domain, ctx.muster.length ? ctx.muster : musterKonfidenzen(new Map()));
    ctx.protokoll.push(`C: ${ctx.kandidaten.length} Kandidaten, erster ${ctx.kandidaten[0]?.adresse ?? '-'}`);
  },
};

// ---------------------------------------------------------------- Schritt D

/** Verifiziert Kandidaten ab `naechsteKandidat`, höchstens `anzahl`; der erste saubere Treffer beendet die Prüfung der übrigen. */
async function pruefeKandidaten(ctx: KontaktKontext, anzahl: number): Promise<void> {
  const domain = ctx.firma.domain!;
  ctx.domain ??= await ctx.deps.verifier.domainEigenschaften(domain);
  if (ctx.domain.mx === 'kein_mx') {
    ctx.protokoll.push(`D: ${domain} nimmt keine Mails an (kein MX)`);
    ctx.naechsteKandidat = ctx.kandidaten.length;
    return;
  }
  if (ctx.domain.catchAll === true) {
    ctx.catchAll = true;
    ctx.protokoll.push(`D: ${domain} ist Catch-All, Einzelprüfung wertlos`);
    return;
  }
  const ende = Math.min(ctx.kandidaten.length, ctx.naechsteKandidat + anzahl);
  while (ctx.naechsteKandidat < ende) {
    const k = ctx.kandidaten[ctx.naechsteKandidat++];
    const e = await ctx.deps.verifier.pruefeAdresse(k.adresse);
    ctx.pruefungen.push(e);
    if (e.status === 'gueltig') {
      ctx.ergebnis = {
        email: k.adresse,
        status: 'gueltig',
        muster: k.muster,
        musterKonfidenz: k.konfidenz,
        konfidenz: ctx.person!.personKonfidenz * KONTAKT_SCHWELLEN.emailVerifiziert,
        verifiziertAm: jetztMs(ctx),
      };
      ctx.fertig = true;
      ctx.protokoll.push(`D: ${k.adresse} gültig (${k.muster}), restliche Kandidaten abgebrochen`);
      return;
    }
    if (e.status === 'catch_all') {
      ctx.catchAll = true;
      ctx.protokoll.push(`D: Server nimmt alles an (Catch-All) bei ${k.adresse}`);
      return;
    }
  }
}

export const verifizieren: ContactStep = {
  name: 'D:verifizieren',
  async run(ctx) {
    if (!ctx.person || !ctx.firma.domain || !ctx.kandidaten.length) return;
    await pruefeKandidaten(ctx, KONTAKT_SCHWELLEN.maxVerifizierungen);
    if (!ctx.fertig) ctx.protokoll.push(`D: ${ctx.pruefungen.length} Kandidaten geprüft, keiner gültig`);
  },
};

// ---------------------------------------------------------------- Schritt E

export const fallbackKaskade: ContactStep = {
  name: 'E:fallback',
  async run(ctx) {
    if (ctx.fertig || !ctx.firma.domain) return;
    const domain = ctx.firma.domain;
    // 1. Weitere Muster testen (zweite Runde über die restlichen Kandidaten)
    if (ctx.person && !ctx.catchAll && ctx.naechsteKandidat < ctx.kandidaten.length && ctx.domain?.mx !== 'kein_mx') {
      await pruefeKandidaten(ctx, KONTAKT_SCHWELLEN.maxVerifizierungen);
      if (ctx.fertig) return;
    }
    // 2. Catch-All-Domain: Adresse nach bestem Muster, deutlich als „best guess“ markiert
    if (ctx.person && ctx.catchAll && ctx.kandidaten[0]) {
      const k = ctx.kandidaten[0];
      ctx.ergebnis = { email: k.adresse, status: 'catch_all_best_guess', muster: k.muster, musterKonfidenz: k.konfidenz, konfidenz: ctx.person.personKonfidenz * KONTAKT_SCHWELLEN.catchAllBestGuess, verifiziertAm: null };
      ctx.protokoll.push(`E: Catch-All-Domain, best guess ${k.adresse} (nicht verifizierbar)`);
      ctx.fertig = true;
      return;
    }
    // 3. Letzter Fallback: generische Postfächer, klar als unpersönlich gekennzeichnet
    const gewuenscht = [...(GENERISCHE_FUER_ROLLE[ctx.rolleKey] ?? []), ...ALLGEMEINE_GENERISCHE];
    const beobachtet = new Set(ctx.bekannteAdressen.filter((a) => istGenerischesPostfach(zerlegeAdresse(a)?.local ?? '')));
    ctx.domain ??= await ctx.deps.verifier.domainEigenschaften(domain);
    for (const local of gewuenscht) {
      const adresse = `${local}@${domain}`;
      const gesehen = beobachtet.has(adresse);
      // Nicht beobachtete Adressen nur, wenn der Server sie bestätigen kann (nicht bei Catch-All oder ohne MX)
      if (!gesehen && (ctx.domain.catchAll === true || ctx.domain.mx === 'kein_mx')) continue;
      const e = ctx.domain.mx === 'kein_mx' ? null : await ctx.deps.verifier.pruefeAdresse(adresse);
      if (e) ctx.pruefungen.push(e);
      if (e?.status === 'gueltig') {
        ctx.ergebnis = { email: adresse, status: 'generisch', muster: null, musterKonfidenz: null, konfidenz: KONTAKT_SCHWELLEN.generischVerifiziert, verifiziertAm: jetztMs(ctx) };
        break;
      }
      // Auf der Website genannt, aber nicht prüfbar (Catch-All, Server blockiert): als unverifiziert unpersönlich anbieten
      if (gesehen && e?.status !== 'ungueltig') {
        ctx.ergebnis = { email: adresse, status: 'generisch_unverifiziert', muster: null, musterKonfidenz: null, konfidenz: KONTAKT_SCHWELLEN.generischUnverifiziert, verifiziertAm: null };
        break;
      }
    }
    ctx.protokoll.push(ctx.ergebnis ? `E: generisches Postfach ${ctx.ergebnis.email} (${ctx.ergebnis.status})` : 'E: keine verwendbare Adresse');
    ctx.fertig = true;
  },
};

export const STANDARD_SCHRITTE: ContactStep[] = [personFinden, musterBestimmen, kandidatenBilden, verifizieren, fallbackKaskade];
