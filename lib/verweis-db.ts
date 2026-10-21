import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { createSlug } from './slug';
import { isSuppressed } from './suppression';

// Verweis in einer Antwort ("wenden Sie sich an Frau Meier, meier@firma.de") → neuer Lead in derselben Kampagne

export type VerweisErgebnis = { ok: true; neuerLeadId: number } | { ok: false; status: number; error: string };

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;

/** "Frau Dr. Anna Meier" → {anrede, vorname, nachname}; ein einzelnes Wort gilt als Nachname. */
export function zerlegeName(name: string | null | undefined): { anrede: string | null; vorname: string | null; nachname: string | null } {
  const teile = (name ?? '').replace(/[,;]/g, ' ').split(/\s+/).filter(Boolean);
  let anrede: string | null = null;
  if (teile.length > 0 && /^(herr|frau)$/i.test(teile[0])) {
    const a = teile.shift()!.toLowerCase();
    anrede = a.charAt(0).toUpperCase() + a.slice(1);
  }
  while (teile.length > 1 && /^(dr|prof|dipl|ing)\.?$/i.test(teile[0])) teile.shift();
  if (teile.length === 0) return { anrede, vorname: null, nachname: null };
  if (teile.length === 1) return { anrede, vorname: null, nachname: teile[0] };
  return { anrede, vorname: teile[0], nachname: teile.slice(1).join(' ') };
}

/**
 * Legt aus dem gespeicherten Verweis (leads.kiVerweis) einen neuen Lead in derselben Kampagne an. Nur mit ausdrücklich
 * genannter E-Mail-Adresse (nie geraten); nicht bei Sperrliste, Duplikat in der Kampagne oder wenn der Verweis auf den
 * Lead selbst zeigt. Der neue Lead erbt Firma, Website, Zeitzone und Postfach, `extra.verwiesen_von` nennt den Verweisenden
 * (nutzbar als {{verwiesen_von}} in Vorlagen), `herkunftLeadId` verweist auf ihn. Im Ursprungs-Lead steht ein Event „verweis“.
 */
export function legeVerweisLeadAn(leadId: number, jetzt: Date = new Date()): VerweisErgebnis {
  const db = getDb();
  return db.transaction((tx): VerweisErgebnis => {
    const lead = tx.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead) return { ok: false, status: 404, error: 'Lead nicht gefunden' };
    const v = lead.kiVerweis;
    if (!v) return { ok: false, status: 409, error: 'In der Antwort wurde kein Verweis erkannt.' };
    if (v.angelegtLeadId) return { ok: false, status: 409, error: 'Der Lead wurde schon angelegt.' };
    const email = v.email?.trim().toLowerCase() ?? '';
    if (!EMAIL.test(email)) return { ok: false, status: 422, error: 'Im Verweis steht keine E-Mail-Adresse. Adressen werden nie geraten, bitte den Lead von Hand anlegen.' };
    if (email === lead.email.trim().toLowerCase()) return { ok: false, status: 409, error: 'Der Verweis zeigt auf denselben Lead.' };
    if (isSuppressed(email)) return { ok: false, status: 409, error: 'Die Adresse oder Domain steht auf der Sperrliste.' };
    const doppelt = tx
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(and(eq(schema.leads.campaignId, lead.campaignId), sql`lower(${schema.leads.email}) = ${email}`))
      .get();
    if (doppelt) return { ok: false, status: 409, error: 'Ein Lead mit dieser Adresse ist schon in der Kampagne.' };
    const kampagne = tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
    if (!kampagne) return { ok: false, status: 404, error: 'Kampagne nicht gefunden' };
    const name = zerlegeName(v.name);
    const vormerken = kampagne.mitVideo && (kampagne.status === 'rendert' || kampagne.status === 'versendet_laufend');
    const verweisender = [lead.vorname, lead.nachname].filter(Boolean).join(' ') || lead.firma;
    const slug = createSlug(lead.firma, (s) => !!tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, s)).get());
    const neu = tx
      .insert(schema.leads)
      .values({
        campaignId: lead.campaignId,
        firma: lead.firma,
        anrede: name.anrede,
        vorname: name.vorname,
        nachname: name.nachname,
        email,
        position: v.position,
        website: lead.website,
        zeitzone: lead.zeitzone,
        extra: { ...(lead.extra ?? {}), verwiesen_von: verweisender },
        slug,
        absenderId: lead.absenderId,
        herkunftLeadId: lead.id,
        renderRequested: vormerken,
      })
      .returning({ id: schema.leads.id })
      .get();
    tx.update(schema.leads).set({ kiVerweis: { ...v, angelegtLeadId: neu.id } }).where(eq(schema.leads.id, lead.id)).run();
    tx.insert(schema.events).values({ leadId: lead.id, type: 'verweis', meta: { zielLeadId: neu.id, email }, createdAt: jetzt }).run();
    return { ok: true, neuerLeadId: neu.id };
  });
}
