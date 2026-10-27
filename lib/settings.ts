import { eq } from 'drizzle-orm';
import { decrypt, encrypt } from './crypto';
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
  | 'ki_auto_status'
  // Klassifizierer der Einordnung: 'anthropic' | 'jev' (Standard: Jev, wenn ein TypeSafe- oder OpenRouter-Schlüssel gesetzt ist)
  | 'ki_klassifizierer'
  // Anbieter für Texte/Entwürfe (Antwort-Entwurf, Schreibhilfe): 'openai' | 'anthropic' (Standard: OpenAI, wenn OPENAI_API_KEY gesetzt ist)
  | 'ki_entwurf_anbieter'
  // API-Schlüssel der KI-Anbieter (AES-GCM verschlüsselt, siehe lib/crypto.ts; nie im Klartext in DB oder Logs)
  | 'anthropic_api_key'
  | 'typesafe_api_key'
  | 'openrouter_api_key'
  | 'openai_api_key'
  // Modell-IDs (Klartext, optional; leer = Standard aus .env bzw. eingebauter Standard)
  | 'openai_model'
  | 'jev_modell'
  | 'typesafe_modell'
  // Prozessia-Schreibregeln prüfen: '0' = aus, sonst an (Standard)
  | 'schreibregeln_aktiv'
  // Brain-Anbindung (Lead-Kontext): URL im Klartext, Token AES-GCM verschlüsselt (lib/brain.ts)
  | 'brain_url'
  | 'brain_token'
  // Vertretung bei Abwesenheit: '0' = aus; Zeitraum 'YYYY-MM-DD'; Empfänger je Kategorie (Komma-getrennt), leer = Standard aus lib/vertretung.ts
  | 'vertretung_aktiv'
  | 'vertretung_von'
  | 'vertretung_bis'
  | 'vertretung_technik'
  | 'vertretung_firma';

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

/** Prozessia-Schreibregeln (keine Gedankenstriche/Trenner/Klammern, Wahrheitsregel) prüfen: Standard an. */
export function schreibregelnAktiv(): boolean {
  return getSetting('schreibregeln_aktiv') !== '0';
}

export const KI_AUTO_STATUS = ['aus', 'vorschlagen', 'automatisch'] as const;
export type KiAutoStatus = (typeof KI_AUTO_STATUS)[number];

/** Umgang mit der KI-Einordnung neuer Antworten (Standard: vorschlagen). */
export function kiAutoStatus(): KiAutoStatus {
  const v = getSetting('ki_auto_status');
  return (KI_AUTO_STATUS as readonly string[]).includes(v ?? '') ? (v as KiAutoStatus) : 'vorschlagen';
}

// ---------------------------------------------------------------- KI-Schlüssel und -Modelle (Einstellung vor .env)

export const KI_ANBIETER = ['typesafe', 'openrouter', 'openai', 'anthropic'] as const;
export type KiAnbieter = (typeof KI_ANBIETER)[number];
export const KI_ANBIETER_LABEL: Record<KiAnbieter, string> = { typesafe: 'TypeSafe (Jev, direkt)', openrouter: 'OpenRouter (Jev)', openai: 'OpenAI', anthropic: 'Claude (Anthropic)' };

const SCHLUESSEL_SETTING: Record<KiAnbieter, SettingKey> = { anthropic: 'anthropic_api_key', typesafe: 'typesafe_api_key', openrouter: 'openrouter_api_key', openai: 'openai_api_key' };

export type KiSchluesselQuelle = 'app' | 'env';

/** Entschlüsselter Schlüssel aus der Datenbank; null = keiner (oder nicht entschlüsselbar, z. B. nach Wechsel des ENCRYPTION_KEY). */
function appSchluessel(anbieter: KiAnbieter): string | null {
  const roh = getSetting(SCHLUESSEL_SETTING[anbieter]);
  if (!roh) return null;
  try {
    return decrypt(roh) || null;
  } catch {
    return null;
  }
}

function envSchluessel(anbieter: KiAnbieter): string | undefined {
  const env = getEnv();
  if (anbieter === 'anthropic') return env.ANTHROPIC_API_KEY;
  if (anbieter === 'typesafe') return env.TYPESAFE_API_KEY;
  return anbieter === 'openrouter' ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;
}

/** Wirksamer Schlüssel und woher er kommt: die Einstellung in der App hat Vorrang vor der .env. Wird bei jedem Aufruf neu gelesen (kein Cache). */
export function kiSchluesselMitQuelle(anbieter: KiAnbieter): { schluessel: string; quelle: KiSchluesselQuelle } | null {
  const app = appSchluessel(anbieter);
  if (app) return { schluessel: app, quelle: 'app' };
  const env = envSchluessel(anbieter);
  return env ? { schluessel: env, quelle: 'env' } : null;
}

/** Wirksamer API-Schlüssel des Anbieters (App-Einstellung vor .env) oder undefined. */
export function kiSchluessel(anbieter: KiAnbieter): string | undefined {
  return kiSchluesselMitQuelle(anbieter)?.schluessel;
}

/** Prüft die Eingabe leicht: nicht leer, keine Leerzeichen/Steuerzeichen, höchstens 300 Zeichen. Liefert den getrimmten Wert oder eine Fehlermeldung. */
export function pruefeKiSchluessel(roh: string): { ok: true; wert: string } | { ok: false; fehler: string } {
  const wert = roh.trim();
  if (!wert) return { ok: false, fehler: 'Bitte einen Schlüssel eingeben.' };
  if (wert.length > 300) return { ok: false, fehler: 'Der Schlüssel ist zu lang (höchstens 300 Zeichen).' };
  if (/[\s\u0000-\u001f\u007f]/.test(wert)) return { ok: false, fehler: 'Der Schlüssel darf keine Leerzeichen oder Zeilenumbrüche enthalten.' };
  return { ok: true, wert };
}

/** Speichert den Schlüssel verschlüsselt (AES-GCM). Die Eingabe muss vorher mit pruefeKiSchluessel geprüft sein. */
export function setzeKiSchluessel(anbieter: KiAnbieter, wert: string): void {
  setSetting(SCHLUESSEL_SETTING[anbieter], encrypt(wert));
}

/** Entfernt nur den in der App gespeicherten Schlüssel; ein .env-Wert bleibt wirksam. */
export function loescheKiSchluessel(anbieter: KiAnbieter): void {
  deleteSetting(SCHLUESSEL_SETTING[anbieter]);
}

/** „…abcd“: nur die letzten 4 Zeichen (bei sehr kurzen Werten gar keine, damit nichts Wesentliches verraten wird). */
export function maskiereSchluessel(wert: string): string {
  return wert.length >= 12 ? `…${wert.slice(-4)}` : '…';
}

/** Modell-ID: Einstellung in der App vor .env vor eingebautem Standard. */
export function kiModell(art: 'openai' | 'jev' | 'typesafe'): string {
  const env = getEnv();
  if (art === 'openai') return getSetting('openai_model')?.trim() || env.OPENAI_MODEL;
  return art === 'typesafe' ? getSetting('typesafe_modell')?.trim() || env.TYPESAFE_JEV_MODELL : getSetting('jev_modell')?.trim() || env.JEV_MODELL;
}

/** Über welchen Zugang läuft Jev? TypeSafe direkt hat Vorrang, sonst OpenRouter; null = kein Schlüssel. */
export function jevAnbieter(): 'typesafe' | 'openrouter' | null {
  return kiSchluessel('typesafe') ? 'typesafe' : kiSchluessel('openrouter') ? 'openrouter' : null;
}

export const KI_KLASSIFIZIERER = ['anthropic', 'jev'] as const;
export type KiKlassifizierer = (typeof KI_KLASSIFIZIERER)[number];

/** Welche Klassifizierer haben einen Schlüssel? */
export function verfuegbareKlassifizierer(): KiKlassifizierer[] {
  return [...(kiSchluessel('anthropic') ? (['anthropic'] as const) : []), ...(jevAnbieter() ? (['jev'] as const) : [])];
}

/**
 * Gewählter Klassifizierer: die Einstellung, sofern deren Schlüssel gesetzt ist; sonst Jev (wenn ein TypeSafe- oder OpenRouter-Schlüssel
 * gesetzt ist), sonst Anthropic. null = keiner verfügbar.
 */
export function kiKlassifizierer(): KiKlassifizierer | null {
  const frei = verfuegbareKlassifizierer();
  const v = getSetting('ki_klassifizierer');
  if (v && (frei as readonly string[]).includes(v)) return v as KiKlassifizierer;
  return frei.includes('jev') ? 'jev' : (frei[0] ?? null);
}

export const KI_ENTWURF_ANBIETER = ['openai', 'anthropic'] as const;
export type KiEntwurfAnbieter = (typeof KI_ENTWURF_ANBIETER)[number];

/** Welche Anbieter für Texte/Entwürfe haben einen Schlüssel? */
export function verfuegbareEntwurfAnbieter(): KiEntwurfAnbieter[] {
  return [...(kiSchluessel('openai') ? (['openai'] as const) : []), ...(kiSchluessel('anthropic') ? (['anthropic'] as const) : [])];
}

/** Gewählter Anbieter für Texte/Entwürfe: die Einstellung, sofern deren Schlüssel gesetzt ist; sonst OpenAI, sonst Anthropic. null = keiner. */
export function kiEntwurfAnbieter(): KiEntwurfAnbieter | null {
  const frei = verfuegbareEntwurfAnbieter();
  const v = getSetting('ki_entwurf_anbieter');
  if (v && (frei as readonly string[]).includes(v)) return v as KiEntwurfAnbieter;
  return frei[0] ?? null;
}
