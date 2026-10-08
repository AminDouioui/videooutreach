import { z } from 'zod';

// Leere Strings aus .env werden wie "nicht gesetzt" behandelt
const leer = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(leer, s.optional());

const envSchema = z.object({
  APP_URL: z.preprocess(leer, z.string().url().default('http://localhost:3000')),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD fehlt'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET muss mindestens 32 Zeichen haben'),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY muss 64 Hex-Zeichen haben'),
  IP_HASH_SALT: z.string().min(1, 'IP_HASH_SALT fehlt'),
  DATA_DIR: z.preprocess(leer, z.string().default('./data')),
  RENDER_CONCURRENCY: z.preprocess(leer, z.coerce.number().int().min(1).max(8).default(1)),
  FFMPEG_PATH: z.preprocess(leer, z.string().default('ffmpeg')),
  REMOTION_BROWSER_EXECUTABLE: opt(z.string()),
  GOOGLE_CLIENT_ID: opt(z.string()),
  GOOGLE_CLIENT_SECRET: opt(z.string()),
  GOOGLE_REDIRECT_URI: z.preprocess(
    leer,
    z.string().url().default('http://localhost:3000/api/gmail/callback'),
  ),
  SENDER_EMAIL: opt(z.string()),
  SENDER_NAME: opt(z.string()),
  DEFAULT_CTA_URL: z.preprocess(leer, z.string().url().default('https://calendly.com/sebastian-spuhler/30min')),
  IMPRESSUM_URL: opt(z.string()),
  DATENSCHUTZ_URL: opt(z.string()),
  SEND_MIN_GAP_MINUTES: z.preprocess(leer, z.coerce.number().min(0).default(3)),
  SEND_MAX_GAP_MINUTES: z.preprocess(leer, z.coerce.number().min(0).default(9)),
});

export type Env = z.infer<typeof envSchema>;

let cache: Env | null = null;

/** Liefert die validierten Umgebungsvariablen. Fehler erst beim ersten Zugriff (Build ohne .env möglich). */
export function getEnv(): Env {
  if (cache) return cache;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const meldungen = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige Umgebungsvariablen: ${meldungen}`);
  }
  cache = result.data;
  return cache;
}

/** Nur für Tests: Cache zurücksetzen. */
export function resetEnvCache(): void {
  cache = null;
}
