// Hilfen für Tests, die über Postfächer (Tabelle `absender`) senden. Kein Test selbst (Dateiname ohne .test).
// Die Module werden erst beim Aufruf geladen, damit die Test-Datei zuvor ihr eigenes DATA_DIR setzen kann.

import type { Absender } from '@/db/schema';

let zaehler = 0;

/** Legt ein verbundenes Postfach an (Standard: amin@prozessia.de, nur gmail.send, sehr hohes Tageslimit). */
export async function legePostfachAn(extra: Partial<typeof import('@/db/schema').absender.$inferInsert> = {}): Promise<Absender> {
  const { getDb, schema } = await import('./db');
  zaehler++;
  return getDb()
    .insert(schema.absender)
    .values({
      email: zaehler === 1 && !extra.email ? 'amin@prozessia.de' : `postfach${zaehler}@prozessia.de`,
      refreshTokenEnc: 'enc-test-token',
      scopes: 'https://www.googleapis.com/auth/gmail.send',
      tageslimit: 1000,
      ...extra,
    })
    .returning()
    .get();
}

/** Abstand, Quota-Stopp und Fehler aller Postfächer zurücksetzen (Ersatz für den früheren globalen send_state). */
export async function setzePostfaecherZurueck(): Promise<void> {
  const { getDb, schema } = await import('./db');
  getDb().update(schema.absender).set({ nextSendAt: null, quotaGestopptAm: null, fehler: null, aktiv: true }).run();
}
