import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { istSmtp, ladeAbsenderMitId, postfachVerbunden, type Absender } from './absender';
import { istBounceFehler } from './bounce-schutz';
import { getDb, schema } from './db';
import type { SmtpKonfig } from './smtp-treiber';
import { entschluesseleZugangsdaten, verschluesseleZugangsdaten } from './zugangsdaten';

// SMTP/IMAP-Postfächer: Eingabeprüfung, Anlegen, Bearbeiten (DB-Teil). Passwörter werden nur verschlüsselt gespeichert und
// nie zurückgegeben; beim Bearbeiten bedeutet ein leeres Passwortfeld „unverändert“.

const hostSchema = z
  .string()
  .trim()
  .min(1, 'Host fehlt')
  .max(253)
  .regex(/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/, 'Ungültiger Host (nur Hostname oder IPv4-Adresse, ohne Schema und Port)');
const portSchema = z.coerce.number().int().min(1).max(65535);
const sicherheitSchema = z.enum(['ssl', 'starttls', 'keine']);
const benutzerSchema = z.string().trim().max(254);
const passwortSchema = z.string().max(500);

const gemeinsam = {
  name: z.string().trim().max(200).nullable().optional(),
  tageslimit: z.coerce.number().int().min(1).max(2000).optional(),
  signatur: z.string().max(5000).nullable().optional(),
  smtpHost: hostSchema,
  smtpPort: portSchema,
  smtpSicherheit: sicherheitSchema,
  smtpBenutzer: benutzerSchema.optional(),
  imapHost: hostSchema,
  imapPort: portSchema,
  imapSicherheit: sicherheitSchema,
  imapBenutzer: benutzerSchema.optional(),
  imapKopieGesendet: z.boolean().optional(),
};

/** Neues Postfach: beide Server müssen angegeben sein; fehlt das IMAP-Passwort, gilt das SMTP-Passwort. */
export const smtpNeuSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse').max(254),
  ...gemeinsam,
  smtpPasswort: passwortSchema.min(1, 'SMTP-Passwort fehlt'),
  imapPasswort: passwortSchema.optional(),
});
export type SmtpNeu = z.infer<typeof smtpNeuSchema>;

/** Bearbeiten: alles optional; leere Passwörter = unverändert. */
export const smtpAenderungSchema = z
  .object({
    ...gemeinsam,
    smtpHost: hostSchema.optional(),
    smtpPort: portSchema.optional(),
    smtpSicherheit: sicherheitSchema.optional(),
    imapHost: hostSchema.optional(),
    imapPort: portSchema.optional(),
    imapSicherheit: sicherheitSchema.optional(),
    smtpPasswort: passwortSchema.optional(),
    imapPasswort: passwortSchema.optional(),
  })
  .partial();
export type SmtpAenderung = z.infer<typeof smtpAenderungSchema>;

/** Verbindungstest: entweder komplette Angaben oder ein vorhandenes Postfach (`absenderId`) mit Überschreibungen. */
export const smtpTestSchema = z.object({
  absenderId: z.number().int().positive().optional(),
  email: z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse').max(254).optional(),
  smtpHost: hostSchema.optional(),
  smtpPort: portSchema.optional(),
  smtpSicherheit: sicherheitSchema.optional(),
  smtpBenutzer: benutzerSchema.optional(),
  smtpPasswort: passwortSchema.optional(),
  imapHost: hostSchema.optional(),
  imapPort: portSchema.optional(),
  imapSicherheit: sicherheitSchema.optional(),
  imapBenutzer: benutzerSchema.optional(),
  imapPasswort: passwortSchema.optional(),
});
export type SmtpTest = z.infer<typeof smtpTestSchema>;

export class SmtpEingabeFehler extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const leerZuNull = (s: string | undefined): string | null => (s && s.trim() !== '' ? s.trim() : null);

/** Legt ein SMTP/IMAP-Postfach an (aktiv, verbunden). Wirft SmtpEingabeFehler (409 bei vorhandener Adresse). */
export function legeSmtpPostfachAn(d: SmtpNeu): Absender {
  const db = getDb();
  if (db.select({ id: schema.absender.id }).from(schema.absender).where(eq(schema.absender.email, d.email)).get()) {
    throw new SmtpEingabeFehler(`Ein Postfach mit der Adresse ${d.email} existiert bereits. Zum Ändern „Bearbeiten“ nutzen; ein getrenntes Postfach lässt sich dort wieder verbinden.`, 409);
  }
  return db
    .insert(schema.absender)
    .values({
      email: d.email,
      typ: 'smtp',
      name: leerZuNull(d.name ?? undefined),
      tageslimit: d.tageslimit ?? 30,
      signatur: d.signatur && d.signatur.trim() !== '' ? d.signatur.replace(/\r\n?/g, '\n').trim() : null,
      aktiv: true,
      smtpHost: d.smtpHost,
      smtpPort: d.smtpPort,
      smtpSicherheit: d.smtpSicherheit,
      smtpBenutzer: leerZuNull(d.smtpBenutzer) ?? d.email,
      imapHost: d.imapHost,
      imapPort: d.imapPort,
      imapSicherheit: d.imapSicherheit,
      imapBenutzer: leerZuNull(d.imapBenutzer) ?? leerZuNull(d.smtpBenutzer) ?? d.email,
      zugangsdatenEnc: verschluesseleZugangsdaten({ smtpPasswort: d.smtpPasswort, imapPasswort: d.imapPasswort && d.imapPasswort !== '' ? d.imapPasswort : d.smtpPasswort }),
      imapKopieGesendet: d.imapKopieGesendet ?? true,
    })
    .returning()
    .get();
}

/**
 * Ändert die Verbindungsdaten eines SMTP-Postfachs. Leere Passwörter lassen die gespeicherten unverändert. Änderungen an
 * Server, Benutzer oder Passwort heben einen Zugangsfehler auf (der nächste Versand zeigt, ob es nun klappt) – der
 * Bounce-Schutz bleibt unberührt. Ein getrenntes Postfach braucht wieder beide Passwörter (bzw. das SMTP-Passwort für beide).
 */
export function aktualisiereSmtpPostfach(id: number, d: SmtpAenderung): Absender {
  const a = ladeAbsenderMitId(id);
  if (!a) throw new SmtpEingabeFehler('Postfach nicht gefunden', 404);
  if (!istSmtp(a)) throw new SmtpEingabeFehler('Dies ist kein SMTP/IMAP-Postfach – Server- und Passwortangaben gelten nur dort.');
  const set: Partial<typeof schema.absender.$inferInsert> = {};
  if (d.smtpHost !== undefined) set.smtpHost = d.smtpHost;
  if (d.smtpPort !== undefined) set.smtpPort = d.smtpPort;
  if (d.smtpSicherheit !== undefined) set.smtpSicherheit = d.smtpSicherheit;
  if (d.smtpBenutzer !== undefined) set.smtpBenutzer = leerZuNull(d.smtpBenutzer) ?? a.email;
  if (d.imapHost !== undefined) set.imapHost = d.imapHost;
  if (d.imapPort !== undefined) set.imapPort = d.imapPort;
  if (d.imapSicherheit !== undefined) set.imapSicherheit = d.imapSicherheit;
  if (d.imapBenutzer !== undefined) set.imapBenutzer = leerZuNull(d.imapBenutzer) ?? a.email;
  if (d.imapKopieGesendet !== undefined) set.imapKopieGesendet = d.imapKopieGesendet;

  const neuSmtp = leerZuNull(d.smtpPasswort);
  const neuImap = leerZuNull(d.imapPasswort);
  let verbindungGeaendert = Object.keys(set).some((k) => k !== 'imapKopieGesendet');
  if (neuSmtp || neuImap) {
    let alt: { smtpPasswort: string; imapPasswort: string } | null = null;
    if (postfachVerbunden(a)) {
      try {
        alt = entschluesseleZugangsdaten(a.zugangsdatenEnc);
      } catch {
        alt = null;
      }
    }
    const smtpPasswort = neuSmtp ?? alt?.smtpPasswort;
    if (!smtpPasswort) throw new SmtpEingabeFehler('Für dieses Postfach liegt kein lesbares Passwort vor – bitte das SMTP-Passwort eingeben.');
    const imapPasswort = neuImap ?? alt?.imapPasswort ?? smtpPasswort;
    set.zugangsdatenEnc = verschluesseleZugangsdaten({ smtpPasswort, imapPasswort });
    verbindungGeaendert = true;
    // War das Postfach getrennt, ist es mit neuen Passwörtern wieder verbunden und aktiv
    if (!postfachVerbunden(a)) set.aktiv = true;
  }
  if (verbindungGeaendert && a.fehler && !istBounceFehler(a.fehler)) set.fehler = null;
  const neu = Object.keys(set).length > 0 ? getDb().update(schema.absender).set(set).where(eq(schema.absender.id, id)).returning().get() : a;
  return neu ?? a;
}

/**
 * Verbindungsdaten für den Verbindungstest: Angaben aus der Anfrage, fehlende (auch leere Passwörter) aus dem vorhandenen
 * Postfach. Wirft SmtpEingabeFehler, wenn etwas fehlt.
 */
export function konfigFuerTest(d: SmtpTest): SmtpKonfig {
  const a = d.absenderId !== undefined ? ladeAbsenderMitId(d.absenderId) : null;
  if (d.absenderId !== undefined && !a) throw new SmtpEingabeFehler('Postfach nicht gefunden', 404);
  if (a && !istSmtp(a)) throw new SmtpEingabeFehler('Dies ist kein SMTP/IMAP-Postfach.');
  let alt: { smtpPasswort: string; imapPasswort: string } | null = null;
  if (a && postfachVerbunden(a)) {
    try {
      alt = entschluesseleZugangsdaten(a.zugangsdatenEnc);
    } catch {
      alt = null;
    }
  }
  const email = d.email ?? a?.email;
  if (!email) throw new SmtpEingabeFehler('E-Mail-Adresse fehlt');
  const smtpHost = d.smtpHost ?? a?.smtpHost;
  const smtpPort = d.smtpPort ?? a?.smtpPort;
  const smtpSicherheit = d.smtpSicherheit ?? a?.smtpSicherheit;
  const imapHost = d.imapHost ?? a?.imapHost;
  const imapPort = d.imapPort ?? a?.imapPort;
  const imapSicherheit = d.imapSicherheit ?? a?.imapSicherheit;
  if (!smtpHost || !smtpPort || !smtpSicherheit) throw new SmtpEingabeFehler('SMTP-Server (Host, Port, Verschlüsselung) fehlt');
  if (!imapHost || !imapPort || !imapSicherheit) throw new SmtpEingabeFehler('IMAP-Server (Host, Port, Verschlüsselung) fehlt');
  const smtpPasswort = leerZuNull(d.smtpPasswort) ?? alt?.smtpPasswort;
  if (!smtpPasswort) throw new SmtpEingabeFehler('SMTP-Passwort fehlt');
  const imapPasswort = leerZuNull(d.imapPasswort) ?? alt?.imapPasswort ?? smtpPasswort;
  const smtpBenutzer = leerZuNull(d.smtpBenutzer) ?? a?.smtpBenutzer ?? email;
  return {
    email,
    smtp: { host: smtpHost, port: smtpPort, sicherheit: smtpSicherheit, benutzer: smtpBenutzer, passwort: smtpPasswort },
    imap: { host: imapHost, port: imapPort, sicherheit: imapSicherheit, benutzer: leerZuNull(d.imapBenutzer) ?? a?.imapBenutzer ?? smtpBenutzer, passwort: imapPasswort },
    kopieGesendet: a?.imapKopieGesendet ?? true,
  };
}
