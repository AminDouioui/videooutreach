import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { firmenSchluessel } from '@/lib/firma';
import { createSlug } from '@/lib/slug';
import { isSuppressed, normalizeEmail } from '@/lib/suppression';
import { ladeLaufErgebnisse, type ErgebnisZeile } from './ergebnisse';
import { istPersonBeiFirmaGesperrt } from './sperre';

// Übernahme der ausgewählten Ergebnisse in eine Kampagne. Vorher: Dedup gegen bestehende Kontakte und Kampagnen und Abgleich mit der
// Sperrliste (Opt-outs, Kunden, Blacklist, gelöschte Personen). Jede Übernahme wird mit ihrer Herkunft protokolliert (Art. 14 DSGVO).

export const UEBERNAHME_STATUS = [
  'uebernommen',
  'nicht_im_lauf',
  'keine_email',
  'email_status_nicht_erlaubt',
  'gesperrt',
  'duplikat_kontakt',
  'duplikat_firma',
  'duplikat_auswahl',
] as const;
export type UebernahmeStatus = (typeof UEBERNAHME_STATUS)[number];

export const UEBERNAHME_LABEL: Record<UebernahmeStatus, string> = {
  uebernommen: 'Übernommen',
  nicht_im_lauf: 'Nicht Teil dieses Laufs',
  keine_email: 'Keine E-Mail-Adresse',
  email_status_nicht_erlaubt: 'E-Mail nicht verifiziert (Status nicht zugelassen)',
  gesperrt: 'Auf der Sperrliste (Opt-out, Kunde, Blacklist oder gelöschte Person)',
  duplikat_kontakt: 'Kontakt existiert schon in einer Kampagne',
  duplikat_firma: 'Firma ist in dieser Kampagne schon vorhanden',
  duplikat_auswahl: 'Doppelt in der Auswahl',
};

export type UebernahmeZeile = { companyId: number; status: UebernahmeStatus; leadId?: number };

export type UebernahmeOptionen = {
  runId: number;
  campaignId: number;
  companyIds: number[];
  /** Zugelassene E-Mail-Status; Standard: nur verifizierte */
  statusErlaubt?: string[];
  benutzer?: string;
  db?: Db;
};

function leadFelder(z: ErgebnisZeile) {
  return {
    firma: z.firma,
    vorname: z.person?.vorname ?? null,
    nachname: z.person?.nachname ?? null,
    position: z.person?.rolleText ?? null,
    website: z.domain ? `https://${z.domain}` : null,
  };
}

export function uebernehmeInKampagne(o: UebernahmeOptionen): { zeilen: UebernahmeZeile[]; uebernommen: number } {
  const db = o.db ?? getDb();
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, o.campaignId)).get();
  if (!kampagne) throw new Error('Kampagne nicht gefunden.');
  const erlaubt = new Set(o.statusErlaubt ?? ['gueltig']);
  const ergebnis = ladeLaufErgebnisse(o.runId, { companyIds: o.companyIds, mindestScore: 0, nurVerifizierteEmail: false }, db);
  const nachId = new Map((ergebnis?.zeilen ?? []).map((z) => [z.companyId, z]));

  // Bestand: E-Mails aller Kampagnen, bereits übernommene Firmen, Firmen der Zielkampagne
  const vorhandeneEmails = new Set(
    db
      .select({ e: schema.leads.email })
      .from(schema.leads)
      .all()
      .map((l) => normalizeEmail(l.e)),
  );
  const uebernommeneFirmen = new Set(db.select({ c: schema.leads.leadgenCompanyId }).from(schema.leads).where(sql`${schema.leads.leadgenCompanyId} is not null`).all().map((l) => l.c));
  const firmenZiel = new Set(db.select({ f: schema.leads.firma }).from(schema.leads).where(eq(schema.leads.campaignId, o.campaignId)).all().map((l) => firmenSchluessel(l.f)));
  const gesehenEmails = new Set<string>();
  const gesehenFirmen = new Set<number>();

  const zeilen: UebernahmeZeile[] = [];
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    const slugExists = (s: string) => !!t.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, s)).get();
    for (const companyId of o.companyIds) {
      const z = nachId.get(companyId);
      if (!z) {
        zeilen.push({ companyId, status: 'nicht_im_lauf' });
        continue;
      }
      if (!z.email) {
        zeilen.push({ companyId, status: 'keine_email' });
        continue;
      }
      if (!erlaubt.has(z.email.status)) {
        zeilen.push({ companyId, status: 'email_status_nicht_erlaubt' });
        continue;
      }
      const email = normalizeEmail(z.email.adresse);
      // Sperrliste: Adresse oder ganze Domain (Opt-outs, Kunden, Blacklist) und gelöschte Personen
      if (isSuppressed(email) || (z.person && istPersonBeiFirmaGesperrt(t, z.person, companyId))) {
        zeilen.push({ companyId, status: 'gesperrt' });
        continue;
      }
      if (gesehenEmails.has(email) || gesehenFirmen.has(companyId)) {
        zeilen.push({ companyId, status: 'duplikat_auswahl' });
        continue;
      }
      if (vorhandeneEmails.has(email) || uebernommeneFirmen.has(companyId)) {
        zeilen.push({ companyId, status: 'duplikat_kontakt' });
        continue;
      }
      if (firmenZiel.has(firmenSchluessel(z.firma))) {
        zeilen.push({ companyId, status: 'duplikat_firma' });
        continue;
      }
      const f = leadFelder(z);
      const slug = createSlug(f.firma, slugExists);
      const extra: Record<string, string> = {
        'E-Mail-Status': z.email.status,
        'E-Mail-Konfidenz': z.email.konfidenz.toFixed(2),
        ...(z.email.muster ? { 'E-Mail-Muster': z.email.muster } : {}),
        'Lead-Quelle': `Lead-Generierung, Lauf ${o.runId}`,
      };
      const lead = t.insert(schema.leads).values({ campaignId: o.campaignId, ...f, email, extra, slug, leadgenCompanyId: companyId, leadgenPersonId: z.person?.id ?? null }).returning({ id: schema.leads.id }).get();
      // Herkunft jedes Datums festhalten (Informationspflicht nach Art. 14 DSGVO)
      t.insert(schema.leadgenUebernahmen)
        .values({
          runId: o.runId,
          companyId,
          personId: z.person?.id ?? null,
          leadId: lead.id,
          campaignId: o.campaignId,
          email,
          benutzer: o.benutzer ?? null,
          herkunft: { email: { status: z.email.status, konfidenz: z.email.konfidenz, muster: z.email.muster, quellen: z.email.quellen }, person: z.person ? { rolle: z.person.rolleText, treffer: z.person.rollenTreffer, quelle: z.person.quelle } : null, firma: z.herkunft },
        })
        .run();
      gesehenEmails.add(email);
      gesehenFirmen.add(companyId);
      zeilen.push({ companyId, status: 'uebernommen', leadId: lead.id });
    }
  });
  return { zeilen, uebernommen: zeilen.filter((x) => x.status === 'uebernommen').length };
}

/** Wurde diese Firma (oder Person) schon in eine Kampagne übernommen? Für die Anzeige im Ergebnis. */
export function bereitsUebernommen(companyIds: number[], db: Db = getDb()): Set<number> {
  if (!companyIds.length) return new Set();
  return new Set(db.select({ c: schema.leads.leadgenCompanyId }).from(schema.leads).where(and(inArray(schema.leads.leadgenCompanyId, companyIds))).all().map((l) => l.c as number));
}
