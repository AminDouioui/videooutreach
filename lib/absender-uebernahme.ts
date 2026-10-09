import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from './db';
import { getEnv } from './env';
import { GMAIL_SCOPE } from './gmail-scopes';

// Übernahme des bisherigen Einzel-Postfachs (Einstellungen gmail_*) als erster Eintrag der Tabelle `absender`.
// Eigene Datei ohne getDb-Aufruf: sie läuft innerhalb der DB-Initialisierung (lib/db.ts) und bekommt die DB übergeben.

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export type Uebernahme = { absenderId: number; email: string; leads: number; mails: number };

/**
 * Macht aus den alten Einstellungen (gmail_refresh_token, gmail_email, gmail_scopes, sender_name …) ein Postfach.
 * Idempotent: ohne alten Token passiert nichts; nach der Übernahme werden die alten Schlüssel gelöscht.
 * Bereits gesendete Leads und Mails werden diesem Postfach zugeordnet (damit Follow-ups und Antwortprüfung
 * weiterlaufen). Die Adresse stammt aus gmail_email bzw. SENDER_EMAIL; fehlt beides, bleibt alles unverändert
 * (der nächste Start versucht es erneut).
 */
export function uebernehmeAltesPostfach(db: Db): Uebernahme | null {
  return db.transaction(
    (tx) => {
      const lies = (key: string) => tx.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null;
      const token = lies('gmail_refresh_token');
      if (!token) return null;

      const env = getEnv();
      const email = (lies('gmail_email') || env.SENDER_EMAIL || '').trim().toLowerCase();
      if (!email) {
        console.warn('[absender] Altes Gmail-Postfach vorhanden, aber keine Adresse bekannt (SENDER_EMAIL setzen) – Übernahme wird beim nächsten Start wiederholt.');
        return null;
      }

      const scopes = lies('gmail_scopes') || GMAIL_SCOPE;
      const name = (lies('sender_name') || env.SENDER_NAME || '').trim() || null;
      // Das bisherige globale Limit galt für dieses eine Postfach: als Tageslimit übernehmen
      const limit = Math.floor(Number(lies('global_daily_limit')));
      const tageslimit = Number.isFinite(limit) && limit > 0 ? limit : 30;
      const beginn = lies('rampe_beginn');
      let nextSendAt: number | null = null;
      let quotaGestopptAm: string | null = null;
      try {
        const s = JSON.parse(lies('send_state') ?? '{}') as { nextSendAt?: unknown; quotaStoppedDate?: unknown };
        if (typeof s.nextSendAt === 'number') nextSendAt = s.nextSendAt;
        if (typeof s.quotaStoppedDate === 'string' && DATUM.test(s.quotaStoppedDate)) quotaGestopptAm = s.quotaStoppedDate;
      } catch {
        // kaputter Zustand: ignorieren
      }

      let row = tx.select().from(schema.absender).where(eq(schema.absender.email, email)).get();
      if (!row) {
        row = tx
          .insert(schema.absender)
          .values({ email, name, refreshTokenEnc: token, scopes, tageslimit, aktiv: true, nextSendAt, quotaGestopptAm, rampeBeginn: beginn && DATUM.test(beginn) ? beginn : null })
          .returning()
          .get();
      } else if (!row.refreshTokenEnc) {
        // Gleiche Adresse war schon als getrenntes Postfach angelegt: Verbindung wiederherstellen
        tx.update(schema.absender).set({ refreshTokenEnc: token, scopes, fehler: null }).where(eq(schema.absender.id, row.id)).run();
      }

      const leads = tx
        .update(schema.leads)
        .set({ absenderId: row.id })
        .where(and(eq(schema.leads.sendStatus, 'gesendet'), isNull(schema.leads.absenderId)))
        .run().changes;
      const mails = tx.update(schema.sentMessages).set({ absenderId: row.id }).where(isNull(schema.sentMessages.absenderId)).run().changes;

      for (const key of ['gmail_refresh_token', 'gmail_email', 'gmail_scopes', 'send_state']) tx.delete(schema.settings).where(eq(schema.settings.key, key)).run();
      return { absenderId: row.id, email, leads, mails };
    },
    { behavior: 'immediate' },
  );
}
