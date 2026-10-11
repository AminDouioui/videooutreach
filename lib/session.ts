import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_DAUER_MS, createSessionToken, hatRolle, pruefeSessionToken, type Rolle, type SessionDaten } from './auth';
import { ladeBenutzer } from './benutzer';
import { getEnv } from './env';

// Node-Seite der Anmeldung. Die Middleware (Edge) prüft nur Signatur und Ablauf des Tokens; ob der Benutzer noch
// existiert, aktiv ist und die Session-Version stimmt, braucht die DB und wird hier geprüft – von jeder API-Route
// (über erfordereRolle) und von den Seiten des Dashboards.

export type AngemeldeterBenutzer = {
  /** 0 = Zugang über ADMIN_PASSWORD */
  id: number;
  email: string | null;
  name: string;
  rolle: Rolle;
  envAdmin: boolean;
};

const ENV_ADMIN_NAME = 'Admin';

/** Cookie `name` aus einem Cookie-Header */
export function cookieWert(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const teil of header.split(';')) {
    const i = teil.indexOf('=');
    if (i > 0 && teil.slice(0, i).trim() === name) {
      const roh = teil.slice(i + 1).trim();
      try {
        return decodeURIComponent(roh);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Token → angemeldeter Benutzer (Signatur, Ablauf, Benutzer vorhanden und aktiv, Session-Version, Rolle unverändert) oder null. */
export async function benutzerAusToken(token: string | undefined, jetzt = Date.now()): Promise<AngemeldeterBenutzer | null> {
  const daten = await pruefeSessionToken(token, getEnv().SESSION_SECRET, jetzt);
  if (!daten) return null;
  if (daten.benutzerId === 0) return { id: 0, email: null, name: ENV_ADMIN_NAME, rolle: 'admin', envAdmin: true };
  const b = ladeBenutzer(daten.benutzerId);
  if (!b || !b.aktiv || b.sessionVersion !== daten.version || b.rolle !== daten.rolle) return null;
  return { id: b.id, email: b.email, name: b.name, rolle: b.rolle, envAdmin: false };
}

/**
 * Der angemeldete Benutzer der aktuellen Anfrage oder null. Mit `req` wird das Cookie der Anfrage gelesen (API-Routen),
 * ohne `req` das Cookie der laufenden Server-Komponente (Layout/Seiten). Die Rolle kommt aus der DB, nie aus einem
 * vom Client schickbaren Header.
 */
export async function aktuellerBenutzer(req?: Request): Promise<AngemeldeterBenutzer | null> {
  let token: string | undefined;
  if (req) token = cookieWert(req.headers.get('cookie'), SESSION_COOKIE);
  else {
    const { cookies } = await import('next/headers');
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  }
  return benutzerAusToken(token);
}

export type RollenPruefung = { ok: true; benutzer: AngemeldeterBenutzer } | { ok: false; response: NextResponse };

export const ROLLEN_NAME: Record<Rolle, string> = { admin: 'Admin', mitglied: 'Mitglied', lesen: 'Nur lesen' };

/**
 * Gemeinsame Prüfung aller Dashboard-API-Routen: eingeloggt (401) und mindestens die Rolle (403).
 * Verwendung: `const auth = await erfordereRolle(req, 'mitglied'); if (!auth.ok) return auth.response;`
 */
export async function erfordereRolle(req: Request, mindestens: Rolle): Promise<RollenPruefung> {
  const benutzer = await aktuellerBenutzer(req);
  if (!benutzer) return { ok: false, response: NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }) };
  if (!hatRolle(benutzer.rolle, mindestens)) {
    const noetig = mindestens === 'admin' ? 'Admin' : 'Mitglied';
    return { ok: false, response: NextResponse.json({ error: `Dafür fehlt Ihnen die Berechtigung (nötig: ${noetig}; Ihre Rolle: ${ROLLEN_NAME[benutzer.rolle]}).` }, { status: 403 }) };
  }
  return { ok: true, benutzer };
}

/** Umhüllt einen fertigen Handler (z. B. aus lib/ki-routen.ts) mit der Rollenprüfung. */
export function mitRolle<A extends unknown[]>(mindestens: Rolle, handler: (req: Request, ...rest: A) => Promise<Response> | Response) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const auth = await erfordereRolle(req, mindestens);
    if (!auth.ok) return auth.response;
    return handler(req, ...rest);
  };
}

/** Setzt das Session-Cookie (Login, Einladung annehmen, Passwortwechsel). */
export async function setzeSessionCookie(res: NextResponse, daten: SessionDaten): Promise<void> {
  const env = getEnv();
  res.cookies.set(SESSION_COOKIE, await createSessionToken(env.SESSION_SECRET, Date.now(), daten), {
    httpOnly: true,
    secure: env.APP_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAUER_MS / 1000,
  });
}
