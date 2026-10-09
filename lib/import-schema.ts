import { z } from 'zod';
import { IMPORT_FELDER } from './import';
import { MAX_ROWS } from './parse-file';

const mappingShape = Object.fromEntries(IMPORT_FELDER.map((f) => [f, z.string().nullable()])) as Record<(typeof IMPORT_FELDER)[number], z.ZodNullable<z.ZodString>>;

/** Body für validate und import */
export const importBodySchema = z.object({
  mapping: z.object(mappingShape),
  rows: z.array(z.record(z.string(), z.string())).max(MAX_ROWS),
  /** Nur einen Kontakt pro Firma importieren */
  einProFirma: z.boolean().default(false),
});
