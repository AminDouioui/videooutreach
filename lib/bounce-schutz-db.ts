import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { BOUNCE_FENSTER_POSTFACH, berechneBounceQuote, kampagnePausiertGrund, postfachBounceFehler, type BounceQuote } from './bounce-schutz';
import { getDb, schema } from './db';
import { bounceSchwellePostfach } from './settings';

// Bounce-Schutz: nach jedem erkannten Bounce Quote der Kampagne und des Postfachs prüfen und ggf. pausieren

export type BounceSchutzErgebnis = { kampagne: BounceQuote | null; kampagnePausiert: boolean; postfach: BounceQuote | null; postfachPausiert: boolean };

/** Bounce-Flags der zuletzt gesendeten Erstmails (neueste zuerst) */
function letzteErstmails(bedingung: ReturnType<typeof eq>, limit: number, ab?: Date | null): boolean[] {
  return getDb()
    .select({ flowStopp: schema.leads.flowStopp })
    .from(schema.leads)
    .where(and(bedingung, eq(schema.leads.sendStatus, 'gesendet'), isNotNull(schema.leads.sentAt), ab ? gte(schema.leads.sentAt, ab) : undefined))
    .orderBy(desc(schema.leads.sentAt), desc(schema.leads.id))
    .limit(limit)
    .all()
    .map((r) => r.flowStopp === 'bounce');
}

/**
 * Prüft nach einem erkannten Bounce Kampagne und Postfach des Leads. Über der Schwelle (und ab 20 gesendeten
 * Erstmails): laufende Kampagne → 'pausiert' mit Grund, Postfach → aktiv=false mit Fehlermeldung.
 */
export function pruefeBounceSchutz(lead: { campaignId: number; absenderId: number | null }): BounceSchutzErgebnis {
  const db = getDb();
  const erg: BounceSchutzErgebnis = { kampagne: null, kampagnePausiert: false, postfach: null, postfachPausiert: false };

  const k = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (k && k.bounceSchutz) {
    erg.kampagne = berechneBounceQuote(letzteErstmails(eq(schema.leads.campaignId, k.id), k.bounceFenster, k.bounceZaehlenAb), { schwelleProzent: k.bounceSchwelleProzent, fenster: k.bounceFenster });
    if (erg.kampagne.ueberSchwelle && k.status === 'versendet_laufend') {
      db.update(schema.campaigns).set({ status: 'pausiert', pausiertGrund: kampagnePausiertGrund(erg.kampagne, k.bounceSchwelleProzent) }).where(eq(schema.campaigns.id, k.id)).run();
      erg.kampagnePausiert = true;
    }
  }

  if (lead.absenderId !== null) {
    const a = db.select().from(schema.absender).where(eq(schema.absender.id, lead.absenderId)).get();
    if (a) {
      erg.postfach = berechneBounceQuote(letzteErstmails(eq(schema.leads.absenderId, a.id), BOUNCE_FENSTER_POSTFACH, a.bounceZaehlenAb), { schwelleProzent: bounceSchwellePostfach(), fenster: BOUNCE_FENSTER_POSTFACH });
      if (erg.postfach.ueberSchwelle && a.aktiv && !a.fehler) {
        db.update(schema.absender).set({ aktiv: false, fehler: postfachBounceFehler(erg.postfach) }).where(eq(schema.absender.id, a.id)).run();
        erg.postfachPausiert = true;
      }
    }
  }
  return erg;
}
