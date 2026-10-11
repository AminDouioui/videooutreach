import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb, schema } from './db';
import { backoffMs, pruefeWebhookZiel, signiere, ZEITLIMIT_MS, type HostResolver } from './webhook-logik';
import { webhookGeheimnis } from './webhooks';

// Zustellung offener Webhook-Zustellungen (läuft im Worker, nie im Request-Pfad)

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'manual' }) => Promise<{ status: number }>;

export type ZustellOptionen = {
  fetchFn?: FetchFn;
  resolver?: HostResolver;
  privatErlaubt?: boolean;
  jetzt?: Date;
  timeoutMs?: number;
  /** Höchstens so viele Zustellungen je Durchlauf */
  max?: number;
};

type Zustellung = typeof schema.webhookZustellungen.$inferSelect;

/** Führt einen Zustellversuch aus und aktualisiert die Zeile (ok / Wiederholung mit Backoff / fehler). */
export async function stelleZu(z: Zustellung, opt: ZustellOptionen = {}): Promise<'ok' | 'wiederholung' | 'fehler'> {
  const db = getDb();
  const jetzt = opt.jetzt ?? new Date();
  const hook = db.select().from(schema.webhooks).where(eq(schema.webhooks.id, z.webhookId)).get();
  const versuche = z.versuche + 1;

  const ergebnis = (fehler: string | null, httpStatus: number | null, dauerhaft = false) => {
    if (fehler === null) {
      db.update(schema.webhookZustellungen).set({ status: 'ok', versuche, httpStatus, letzterFehler: null, zugestelltAt: new Date(), naechsterVersuchAt: null }).where(eq(schema.webhookZustellungen.id, z.id)).run();
      return 'ok' as const;
    }
    const warte = dauerhaft ? null : backoffMs(versuche);
    if (warte === null) {
      db.update(schema.webhookZustellungen).set({ status: 'fehler', versuche, httpStatus, letzterFehler: fehler.slice(0, 500), naechsterVersuchAt: null }).where(eq(schema.webhookZustellungen.id, z.id)).run();
      return 'fehler' as const;
    }
    db.update(schema.webhookZustellungen).set({ status: 'offen', versuche, httpStatus, letzterFehler: fehler.slice(0, 500), naechsterVersuchAt: new Date(jetzt.getTime() + warte) }).where(eq(schema.webhookZustellungen.id, z.id)).run();
    return 'wiederholung' as const;
  };

  if (!hook) return ergebnis('Webhook existiert nicht mehr', null, true);
  // Ziel bei jedem Versuch prüfen (DNS kann sich ändern)
  const ziel = await pruefeWebhookZiel(hook.url, { resolver: opt.resolver, privatErlaubt: opt.privatErlaubt });
  if (!ziel.ok) return ergebnis(`Ziel abgelehnt: ${ziel.grund}`, null, true);

  let geheimnis: string;
  try {
    geheimnis = webhookGeheimnis(hook);
  } catch {
    return ergebnis('Geheimnis nicht lesbar (ENCRYPTION_KEY geändert?)', null, true);
  }
  const body = JSON.stringify(z.payload);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opt.timeoutMs ?? ZEITLIMIT_MS);
  try {
    const res = await (opt.fetchFn ?? ((u, init) => fetch(u, init)))(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VideoOutreach-Webhook/1',
        'X-Signatur': signiere(geheimnis, body),
        'X-Ereignis': z.ereignis,
        'X-Zustellung-Id': String(z.id),
      },
      body,
      signal: ctrl.signal,
      redirect: 'manual',
    });
    if (res.status >= 200 && res.status < 300) return ergebnis(null, res.status);
    return ergebnis(`HTTP ${res.status}`, res.status);
  } catch (e) {
    if (ctrl.signal.aborted) return ergebnis(`Zeitüberschreitung (${Math.round((opt.timeoutMs ?? ZEITLIMIT_MS) / 1000)} s)`, null);
    return ergebnis(`Verbindungsfehler: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}`, null);
  } finally {
    clearTimeout(timer);
  }
}

/** Stellt alle fälligen offenen Zustellungen zu (älteste zuerst). Liefert die Anzahl bearbeiteter Zustellungen. */
export async function stelleFaelligeZu(opt: ZustellOptionen = {}): Promise<number> {
  const jetzt = opt.jetzt ?? new Date();
  const faellig = getDb()
    .select()
    .from(schema.webhookZustellungen)
    .where(and(eq(schema.webhookZustellungen.status, 'offen'), lte(schema.webhookZustellungen.naechsterVersuchAt, jetzt)))
    .orderBy(asc(schema.webhookZustellungen.id))
    .limit(opt.max ?? 20)
    .all();
  for (const z of faellig) await stelleZu(z, { ...opt, jetzt });
  return faellig.length;
}
