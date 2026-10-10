import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';

// Key/Value-Einstellungen in der Tabelle `settings`

export type SettingKey =
  // Standard-Absendername und -Signatur für Postfächer ohne eigene Werte (die Verbindungen selbst: Tabelle `absender`)
  | 'sender_name'
  | 'signature'
  | 'global_daily_limit'
  | 'impressum_url'
  | 'datenschutz_url'
  // Aufwärmrampe: '1' = aktiv, Startwert, Steigerung pro Tag, erster Tag 'YYYY-MM-DD' (leer = erste gesendete Mail)
  | 'rampe_aktiv'
  | 'rampe_start'
  | 'rampe_schritt'
  | 'rampe_beginn'
  // Bounce-Schutz je Postfach: Schwelle in Prozent (letzte 50 Erstmails des Postfachs)
  | 'bounce_schwelle_postfach'
  // KI-Einordnung von Antworten: 'aus' | 'vorschlagen' (Standard) | 'automatisch'
  | 'ki_auto_status';

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

export const RAMPE_STANDARD = { start: 10, schritt: 5 } as const;

export type RampeEinstellung = { aktiv: boolean; start: number; schritt: number; beginn: string | null };

function positiveZahl(s: string | null, standard: number, min: number): number {
  const n = Number(s);
  return s !== null && s !== '' && Number.isFinite(n) && n >= min ? Math.floor(n) : standard;
}

/** Gespeicherte Rampen-Einstellung (beginn = ausdrücklich gesetzter erster Tag, sonst null). */
export function rampeEinstellung(): RampeEinstellung {
  const beginn = getSetting('rampe_beginn');
  return {
    aktiv: getSetting('rampe_aktiv') === '1',
    start: positiveZahl(getSetting('rampe_start'), RAMPE_STANDARD.start, 1),
    schritt: positiveZahl(getSetting('rampe_schritt'), RAMPE_STANDARD.schritt, 0),
    beginn: beginn && /^\d{4}-\d{2}-\d{2}$/.test(beginn) ? beginn : null,
  };
}

/** Bounce-Schwelle je Postfach in Prozent (Standard 5). */
export function bounceSchwellePostfach(): number {
  const n = Number(getSetting('bounce_schwelle_postfach'));
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 5;
}

export const KI_AUTO_STATUS = ['aus', 'vorschlagen', 'automatisch'] as const;
export type KiAutoStatus = (typeof KI_AUTO_STATUS)[number];

/** Umgang mit der KI-Einordnung neuer Antworten (Standard: vorschlagen). */
export function kiAutoStatus(): KiAutoStatus {
  const v = getSetting('ki_auto_status');
  return (KI_AUTO_STATUS as readonly string[]).includes(v ?? '') ? (v as KiAutoStatus) : 'vorschlagen';
}
