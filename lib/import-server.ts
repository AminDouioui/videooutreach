import { ladeImportKontext } from './campaigns';
import { applyMapping, validateRows, type ValidatedRow } from './import';
import type { z } from 'zod';
import type { importBodySchema } from './import-schema';
import { emailDomain } from './lead-status';
import { pruefeDomains, type DnsResolver } from './mx';

// Serverseitige Import-Prüfung (validate- und import-Route teilen sich diese Funktion)

export type ImportBody = z.infer<typeof importBodySchema>;

/** Validiert die Zeilen inkl. MX-Prüfung der Domains (nur für Zeilen, die sonst gültig wären). */
export async function validiereImport(campaignId: number, body: ImportBody, resolver?: DnsResolver): Promise<ValidatedRow[]> {
  const kontext = { ...ladeImportKontext(campaignId), einProFirma: body.einProFirma, mxTrotzdem: body.mxTrotzdem };
  // Erst ohne MX prüfen, damit nur die Domains gültiger Zeilen abgefragt werden
  const vorlaeufig = validateRows(body.rows, body.mapping, kontext);
  const domains = new Set<string>();
  for (const r of vorlaeufig) {
    if (r.status !== 'ok') continue;
    const d = emailDomain(applyMapping(body.rows[r.index], body.mapping).email);
    if (d) domains.add(d);
  }
  if (domains.size === 0) return vorlaeufig;
  const mx = await pruefeDomains(domains, resolver);
  return validateRows(body.rows, body.mapping, { ...kontext, mx });
}
