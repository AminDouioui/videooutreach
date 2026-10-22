import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { pruefeDomains, type MxErgebnis } from '@/lib/mx';
import { VERIFIZIERUNG_ABSTAND_MS, VERIFIZIERUNG_GUELTIG_TAGE, VERIFIZIERUNG_UNBEKANNT_STUNDEN } from '../config';

// Schritt D: Verifizierung. Der eigentliche SMTP-Check (Handshake bis RCPT TO, ohne zu senden) läuft über einen austauschbaren
// EmailVerifier (Standard: Reacher/check-if-email-exists als eigener Dienst, siehe reacher.ts, damit die Reputation unserer
// Versand-Domain und -IP nicht belastet wird). Dieser Wrapper ergänzt MX-Prüfung, Catch-All-Erkennung, Rate-Limit je Zieldomain
// und den Cache: dieselbe Adresse wird nie doppelt geprüft.

export type VerifizierungsStatus = (typeof schema.emailVerifications.$inferSelect)['status'];
export type VerifizierungsErgebnis = { status: VerifizierungsStatus; details?: Record<string, unknown> };

export interface EmailVerifier {
  readonly name: string;
  pruefe(adresse: string): Promise<VerifizierungsErgebnis>;
}

/** Fester Antwortgeber für Tests: `antwort` entscheidet je Adresse. */
export class FakeVerifier implements EmailVerifier {
  readonly name = 'fake';
  readonly aufrufe: string[] = [];
  constructor(private readonly antwort: (adresse: string) => VerifizierungsStatus | VerifizierungsErgebnis) {}
  async pruefe(adresse: string): Promise<VerifizierungsErgebnis> {
    this.aufrufe.push(adresse);
    const a = this.antwort(adresse);
    return typeof a === 'string' ? { status: a } : a;
  }
}

export type GeprueftEintrag = VerifizierungsErgebnis & { adresse: string; ausCache: boolean };
export type DomainEigenschaften = { mx: MxErgebnis; catchAll: boolean | null };

export type VerifierOptionen = {
  verifier: EmailVerifier;
  db?: Db;
  /** MX-Prüfung (Standard: lib/mx.ts) */
  mx?: (domain: string) => Promise<MxErgebnis>;
  minAbstandMs?: number;
  jetzt?: () => number;
  warte?: (ms: number) => Promise<void>;
  /** Erzeugt den Zufallsanteil der Catch-All-Testadresse */
  zufall?: () => string;
};

export class GedrosselterVerifier {
  private readonly letzte = new Map<string, number>();
  private readonly kette = new Map<string, Promise<void>>();
  constructor(private readonly opt: VerifierOptionen) {}

  private db(): Db {
    return this.opt.db ?? getDb();
  }
  private jetzt(): number {
    return (this.opt.jetzt ?? Date.now)();
  }
  get name(): string {
    return this.opt.verifier.name;
  }

  private async drosseln(domain: string): Promise<void> {
    const abstand = this.opt.minAbstandMs ?? VERIFIZIERUNG_ABSTAND_MS;
    const vorher = this.kette.get(domain) ?? Promise.resolve();
    const dran = vorher.then(async () => {
      const warten = (this.letzte.get(domain) ?? 0) + abstand - this.jetzt();
      if (warten > 0) await (this.opt.warte ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(warten);
      this.letzte.set(domain, this.jetzt());
    });
    this.kette.set(domain, dran.catch(() => undefined));
    await dran;
  }

  private speichere(adresse: string, domain: string, e: VerifizierungsErgebnis): void {
    this.db()
      .insert(schema.emailVerifications)
      .values({ adresse, domain, status: e.status, details: e.details ?? null, verifier: this.opt.verifier.name, geprueftAm: new Date(this.jetzt()) })
      .onConflictDoUpdate({ target: schema.emailVerifications.adresse, set: { status: e.status, details: e.details ?? null, verifier: this.opt.verifier.name, geprueftAm: new Date(this.jetzt()) } })
      .run();
  }

  /** Gespeicherte Prüfung, solange sie gilt (30 Tage; ‚unbekannt‘ nur 24 Stunden, damit es bald erneut versucht wird). */
  private gecacht(adresse: string): VerifizierungsErgebnis | null {
    const z = this.db().select().from(schema.emailVerifications).where(eq(schema.emailVerifications.adresse, adresse)).get();
    if (!z) return null;
    const alterMs = this.jetzt() - z.geprueftAm.getTime();
    const grenze = z.status === 'unbekannt' ? VERIFIZIERUNG_UNBEKANNT_STUNDEN * 3600_000 : VERIFIZIERUNG_GUELTIG_TAGE * 86400_000;
    return alterMs < grenze ? { status: z.status, details: z.details ?? undefined } : null;
  }

  /** MX und Catch-All der Domain (30 Tage gemerkt). Catch-All: eine zufällige Adresse; nimmt der Server alles an, ist Einzel-Verifizierung wertlos. */
  async domainEigenschaften(domain: string): Promise<DomainEigenschaften> {
    const d = domain.toLowerCase();
    const z = this.db().select().from(schema.domainMailStatus).where(eq(schema.domainMailStatus.domain, d)).get();
    if (z && this.jetzt() - z.geprueftAm.getTime() < VERIFIZIERUNG_GUELTIG_TAGE * 86400_000 && z.mx !== 'unbekannt') return { mx: z.mx, catchAll: z.catchAll };
    const mx = await (this.opt.mx ?? (async (x: string) => (await pruefeDomains([x])).get(x) ?? 'unbekannt'))(d);
    let catchAll: boolean | null = null;
    if (mx === 'ok') {
      const test = `${this.opt.zufall ? this.opt.zufall() : `zz${randomBytes(6).toString('hex')}`}@${d}`;
      await this.drosseln(d);
      const r = await this.opt.verifier.pruefe(test).catch((): VerifizierungsErgebnis => ({ status: 'unbekannt' }));
      // Eine erfundene Adresse wird akzeptiert → Catch-All. Ausdrücklich abgelehnt → kein Catch-All. Sonst: nicht feststellbar.
      catchAll = r.status === 'gueltig' || r.status === 'catch_all' ? true : r.status === 'ungueltig' ? false : null;
    }
    this.db()
      .insert(schema.domainMailStatus)
      .values({ domain: d, mx, catchAll, geprueftAm: new Date(this.jetzt()) })
      .onConflictDoUpdate({ target: schema.domainMailStatus.domain, set: { mx, catchAll, geprueftAm: new Date(this.jetzt()) } })
      .run();
    return { mx, catchAll };
  }

  /** Prüft eine Adresse (aus dem Cache, wenn gültig). Ohne MX ist jede Adresse der Domain ungültig, ohne SMTP-Verbindung. */
  async pruefeAdresse(adresse: string): Promise<GeprueftEintrag> {
    const a = adresse.toLowerCase().trim();
    const domain = a.split('@')[1];
    const cache = this.gecacht(a);
    if (cache) return { adresse: a, ...cache, ausCache: true };
    const eig = await this.domainEigenschaften(domain);
    if (eig.mx === 'kein_mx') {
      const e: VerifizierungsErgebnis = { status: 'ungueltig', details: { grund: 'kein_mx' } };
      this.speichere(a, domain, e);
      return { adresse: a, ...e, ausCache: false };
    }
    await this.drosseln(domain);
    let e = await this.opt.verifier.pruefe(a).catch((fehler: unknown): VerifizierungsErgebnis => ({ status: 'unbekannt', details: { fehler: String(fehler instanceof Error ? fehler.message : fehler).slice(0, 200) } }));
    // Meldet der Dienst für diese Adresse „Catch-All“, ist die ganze Domain betroffen: merken
    if (e.status === 'catch_all' && eig.catchAll !== true) {
      this.db().update(schema.domainMailStatus).set({ catchAll: true }).where(eq(schema.domainMailStatus.domain, domain)).run();
    }
    // Auf einer Catch-All-Domain sagt „gültig“ nichts über das Postfach aus
    if (e.status === 'gueltig' && eig.catchAll === true) e = { status: 'catch_all', details: { ...e.details, grund: 'domain_catch_all' } };
    this.speichere(a, domain, e);
    return { adresse: a, ...e, ausCache: false };
  }
}
