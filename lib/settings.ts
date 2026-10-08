import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';

// Key/Value-Einstellungen in der Tabelle `settings`

export type SettingKey =
  | 'gmail_refresh_token'
  | 'gmail_email'
  | 'sender_name'
  | 'signature'
  | 'global_daily_limit'
  | 'impressum_url'
  | 'datenschutz_url'
  | 'send_state';

export function getSetting(key: SettingKey): string | null {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: SettingKey, value: string): void {
  getDb()
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
}

export function deleteSetting(key: SettingKey): void {
  getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run();
}

/** Impressum-/Datenschutz-URL: Einstellung hat Vorrang vor .env. */
export function legalUrls(): { impressum: string | null; datenschutz: string | null } {
  const env = getEnv();
  return {
    impressum: getSetting('impressum_url') || env.IMPRESSUM_URL || null,
    datenschutz: getSetting('datenschutz_url') || env.DATENSCHUTZ_URL || null,
  };
}

/** Globales Tageslimit über alle Kampagnen (Standard 30). */
export function globalDailyLimit(): number {
  const n = Number(getSetting('global_daily_limit'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}
