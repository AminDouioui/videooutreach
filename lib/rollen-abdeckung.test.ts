import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

// 1) Dateisystem-Test: JEDE Methode JEDER Route unter app/api nutzt erfordereRolle/mitRolle – oder steht auf der
//    ausdrücklichen Ausnahmeliste. Zusätzlich ist die verlangte Mindestrolle je Route festgeschrieben.
// 2) Stichproben: echte Handler-Aufrufe mit Cookies der Rollen „lesen“/„mitglied“ liefern 403 bzw. 401.

const API = path.resolve(__dirname, '../app/api');

/** Routen ohne Session-Rolle: öffentlich oder mit eigener Authentisierung (Begründung dahinter). */
const AUSNAHMEN: Record<string, string> = {
  'auth/login': 'öffentlich: Login selbst (Ratelimit)',
  'auth/logout': 'löscht nur das eigene Cookie',
  'einladung/[token]': 'öffentlich: der Einladungs-Token ist das Geheimnis (Ratelimit)',
  't': 'öffentlich: Tracking-Pixel',
  'c/[token]': 'öffentlich: signierter Link-Tracking-Token',
  'o/[file]': 'öffentlich: Öffnungs-/Vorschaubilder',
  'unsubscribe/[slug]': 'öffentlich: Abmeldung über Lead-Slug',
  'v1/kampagnen': 'eigene Auth: Bearer-API-Schlüssel',
  'v1/kampagnen/[id]': 'eigene Auth: Bearer-API-Schlüssel',
  'v1/kampagnen/[id]/leads': 'eigene Auth: Bearer-API-Schlüssel',
  'v1/leads/[id]': 'eigene Auth: Bearer-API-Schlüssel',
  'gmail/callback': 'prüft den OAuth-state (Cookie aus dem Admin-only-Start /api/gmail/connect)',
};

/** Erwartete Mindestrolle je Route und Methode */
const ERWARTET: Record<string, string> = {
  'POST absender': 'admin',
  'POST absender/verbindungstest': 'admin',
  'PATCH absender/[id]': 'admin',
  'DELETE absender/[id]': 'admin',
  'POST api-schluessel': 'admin',
  'DELETE api-schluessel/[id]': 'admin',
  'GET benutzer': 'admin',
  'POST benutzer/einladungen': 'admin',
  'DELETE benutzer/einladungen/[id]': 'admin',
  'PATCH benutzer/[id]': 'admin',
  'DELETE benutzer/[id]': 'admin',
  'POST benutzer/[id]/passwort-zuruecksetzen': 'admin',
  'PATCH konto': 'lesen',
  'GET campaigns': 'lesen',
  'POST campaigns': 'mitglied',
  'DELETE campaigns/[id]': 'admin',
  'POST campaigns/[id]/duplizieren': 'mitglied',
  'GET campaigns/[id]/export.csv': 'lesen',
  'POST campaigns/[id]/firmen-duplikate': 'mitglied',
  'PUT campaigns/[id]/followups': 'mitglied',
  'POST campaigns/[id]/import': 'mitglied',
  'POST campaigns/[id]/import/validate': 'mitglied',
  'POST campaigns/[id]/ki/vorlage': 'mitglied',
  'POST campaigns/[id]/render': 'mitglied',
  'GET campaigns/[id]/send': 'lesen',
  'POST campaigns/[id]/send': 'mitglied',
  'PUT campaigns/[id]/settings': 'mitglied',
  'GET campaigns/[id]/status': 'lesen',
  'PUT campaigns/[id]/template': 'mitglied',
  'POST campaigns/[id]/test-mail': 'mitglied',
  'GET campaigns/[id]/untersequenzen': 'lesen',
  'POST campaigns/[id]/untersequenzen': 'mitglied',
  'PATCH campaigns/[id]/untersequenzen/[rid]': 'mitglied',
  'DELETE campaigns/[id]/untersequenzen/[rid]': 'mitglied',
  'GET campaigns/[id]/varianten': 'lesen',
  'POST campaigns/[id]/varianten': 'mitglied',
  'PUT campaigns/[id]/varianten/[vid]': 'mitglied',
  'DELETE campaigns/[id]/varianten/[vid]': 'mitglied',
  'GET gmail/connect': 'admin',
  'POST leads/[id]/antworten': 'mitglied',
  'POST leads/[id]/ki/einordnen': 'mitglied',
  'POST leads/[id]/ki/entwurf': 'mitglied',
  'POST leads/[id]/ki/uebernehmen': 'mitglied',
  'GET leads/[id]/mail-preview': 'lesen',
  'POST leads/[id]/mail-preview': 'lesen',
  'POST leads/[id]/render': 'mitglied',
  'PATCH leads/[id]': 'mitglied',
  'DELETE leads/[id]': 'mitglied',
  'POST leads/[id]/send': 'mitglied',
  'GET leads/[id]/thread': 'lesen',
  'GET settings': 'lesen',
  'PUT settings': 'admin',
  'PUT settings/ki-schluessel': 'admin',
  'DELETE settings/ki-schluessel': 'admin',
  'POST settings/ki-schluessel/test': 'admin',
  'GET suppression': 'lesen',
  'POST suppression': 'mitglied',
  'DELETE suppression': 'mitglied',
  'POST upload/parse': 'mitglied',
  'POST webhook-zustellungen/[id]/erneut': 'admin',
  'GET webhooks/[id]/geheimnis': 'admin',
  'POST webhooks/[id]/geheimnis': 'admin',
  'POST webhooks/[id]/test': 'admin',
  'PATCH webhooks/[id]': 'admin',
  'DELETE webhooks/[id]': 'admin',
  'POST webhooks': 'admin',
};

function routen(dir: string, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return routen(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
    return /^route\.(ts|tsx|js)$/.test(e.name) ? [rel] : [];
  });
}

/** Alle exportierten HTTP-Methoden einer Route mit dem zugehörigen Quelltext-Abschnitt */
function methoden(quelltext: string): { methode: string; text: string }[] {
  const re = /^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm;
  const treffer = [...quelltext.matchAll(re)];
  return treffer.map((t, i) => {
    const von = t.index!;
    const bis = i + 1 < treffer.length ? treffer[i + 1].index! : quelltext.length;
    return { methode: t[1], text: quelltext.slice(von, bis) };
  });
}

describe('Rollenprüfung: Abdeckung aller Route-Dateien', () => {
  const alle = routen(API).sort();

  it('es werden Routen gefunden', () => {
    expect(alle.length).toBeGreaterThan(40);
  });

  it('jede Methode nutzt erfordereRolle/mitRolle oder steht auf der Ausnahmeliste', () => {
    const ohne: string[] = [];
    for (const r of alle) {
      if (r in AUSNAHMEN) continue;
      const quelle = fs.readFileSync(path.join(API, r, 'route.ts'), 'utf8');
      const ms = methoden(quelle);
      expect(ms.length, `${r}: keine Methode gefunden`).toBeGreaterThan(0);
      for (const { methode, text } of ms) if (!/\b(erfordereRolle|mitRolle)\(/.test(text)) ohne.push(`${methode} ${r}`);
    }
    expect(ohne).toEqual([]);
  });

  it('Mutationen (POST/PUT/PATCH/DELETE) stehen nie auf der Ausnahmeliste, außer den begründeten', () => {
    const mutierend = alle.filter((r) => r in AUSNAHMEN).filter((r) => methoden(fs.readFileSync(path.join(API, r, 'route.ts'), 'utf8')).some((x) => x.methode !== 'GET'));
    expect(mutierend.sort()).toEqual(['auth/login', 'auth/logout', 'c/[token]', 'einladung/[token]', 'unsubscribe/[slug]', 't', 'v1/kampagnen/[id]/leads', 'v1/leads/[id]'].sort());
  });

  it('die Ausnahmeliste enthält keine toten Einträge', () => {
    for (const r of Object.keys(AUSNAHMEN)) expect(alle, `Ausnahme ohne Route: ${r}`).toContain(r);
  });

  it('die verlangte Mindestrolle je Route entspricht der festgeschriebenen Matrix', () => {
    const ist: Record<string, string> = {};
    for (const r of alle) {
      if (r in AUSNAHMEN) continue;
      const quelle = fs.readFileSync(path.join(API, r, 'route.ts'), 'utf8');
      for (const { methode, text } of methoden(quelle)) {
        const m = text.match(/\b(?:erfordereRolle\(\s*req\s*,|mitRolle\()\s*'(admin|mitglied|lesen)'/);
        ist[`${methode} ${r}`] = m ? m[1] : '?';
      }
    }
    expect(ist).toEqual(ERWARTET);
  });

  it('Mutationen verlangen mindestens „mitglied“ (außer dem eigenen Konto und reinen Vorschau-/Prüf-POSTs)', () => {
    const lesendeMutation = Object.entries(ERWARTET).filter(([k, v]) => v === 'lesen' && !k.startsWith('GET '));
    expect(lesendeMutation.map(([k]) => k).sort()).toEqual(['PATCH konto', 'POST leads/[id]/mail-preview']);
  });

  it('keine Route liest die Rolle aus den vom Client schickbaren Headern', () => {
    const lib = ['session.ts', 'benutzer.ts'].map((f) => fs.readFileSync(path.resolve(__dirname, f), 'utf8')).join('\n');
    expect(lib).not.toMatch(/x-vo-rolle|x-vo-benutzer|HEADER_ROLLE|HEADER_BENUTZER/);
    for (const r of alle) expect(fs.readFileSync(path.join(API, r, 'route.ts'), 'utf8')).not.toMatch(/x-vo-rolle|x-vo-benutzer/);
  });
});

describe('Dashboard-Seiten prüfen die Session selbst', () => {
  const seiten = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? seiten(path.join(dir, e.name)) : e.name === 'page.tsx' ? [path.join(dir, e.name)] : []));
  it('jede page.tsx und das Layout rufen erforderSeitenRolle auf', () => {
    const wurzel = path.resolve(__dirname, '../app/(dashboard)');
    const dateien = [...seiten(wurzel), path.join(wurzel, 'layout.tsx')];
    expect(dateien.length).toBeGreaterThan(10);
    for (const d of dateien) expect(fs.readFileSync(d, 'utf8'), d).toContain('erforderSeitenRolle(');
  });
  it('Benutzer- und Integrationsseite verlangen admin, Import und neue Kampagne mindestens mitglied', () => {
    const w = path.resolve(__dirname, '../app/(dashboard)');
    for (const [datei, rolle] of [
      ['einstellungen/benutzer/page.tsx', 'admin'],
      ['einstellungen/integrationen/page.tsx', 'admin'],
      ['kampagnen/neu/page.tsx', 'mitglied'],
      ['kampagnen/[id]/import/page.tsx', 'mitglied'],
    ]) {
      expect(fs.readFileSync(path.join(w, datei), 'utf8'), datei).toContain(`erforderSeitenRolle('${rolle}')`);
    }
  });
});

// ---------- Stichproben mit echten Handler-Aufrufen ----------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-rollen-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

const cookies: Record<'admin' | 'mitglied' | 'lesen', string> = { admin: '', mitglied: '', lesen: '' };
let campaignId = 0;

beforeAll(async () => {
  const db = await import('./db');
  const auth = await import('./auth');
  const ph = '0'.repeat(32) + ':' + '0'.repeat(128);
  for (const rolle of ['admin', 'mitglied', 'lesen'] as const) {
    const b = db.getDb().insert(db.schema.benutzer).values({ email: `${rolle}@x.de`, name: rolle, passwortHash: ph, rolle }).returning().get();
    cookies[rolle] = `vo_session=${await auth.createSessionToken('r'.repeat(32), Date.now(), { benutzerId: b.id, rolle, version: b.sessionVersion })}`;
  }
  campaignId = db.getDb().insert(db.schema.campaigns).values({ name: 'K', ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b' }).returning().get().id;
});

const req = (method: string, rolle: keyof typeof cookies | null, body?: unknown, extra: Record<string, string> = {}) =>
  new Request('https://video.example.de/api/x', { method, headers: { 'content-type': 'application/json', ...(rolle ? { cookie: cookies[rolle] } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
const id = () => ({ params: Promise.resolve({ id: String(campaignId), vid: '1', rid: '1' }) });

type Handler = (req: Request, ctx: never) => Promise<Response> | Response;
const stichproben: { name: string; laden: () => Promise<Record<string, Handler>>; methode: string; mindestens: 'mitglied' | 'admin'; body?: unknown }[] = [
  { name: 'campaigns', laden: () => import('../app/api/campaigns/route') as never, methode: 'POST', mindestens: 'mitglied', body: { name: 'N', ctaUrl: 'https://x.de' } },
  { name: 'campaigns/[id]', laden: () => import('../app/api/campaigns/[id]/route') as never, methode: 'DELETE', mindestens: 'admin' },
  { name: 'campaigns/[id]/send', laden: () => import('../app/api/campaigns/[id]/send/route') as never, methode: 'POST', mindestens: 'mitglied', body: { action: 'start' } },
  { name: 'campaigns/[id]/template', laden: () => import('../app/api/campaigns/[id]/template/route') as never, methode: 'PUT', mindestens: 'mitglied', body: {} },
  { name: 'campaigns/[id]/settings', laden: () => import('../app/api/campaigns/[id]/settings/route') as never, methode: 'PUT', mindestens: 'mitglied', body: {} },
  { name: 'campaigns/[id]/import', laden: () => import('../app/api/campaigns/[id]/import/route') as never, methode: 'POST', mindestens: 'mitglied', body: {} },
  { name: 'suppression', laden: () => import('../app/api/suppression/route') as never, methode: 'POST', mindestens: 'mitglied', body: { email: 'a@b.de' } },
  { name: 'leads/[id]', laden: () => import('../app/api/leads/[id]/route') as never, methode: 'PATCH', mindestens: 'mitglied', body: { notizen: 'x' } },
  { name: 'leads/[id]/send', laden: () => import('../app/api/leads/[id]/send/route') as never, methode: 'POST', mindestens: 'mitglied' },
  { name: 'leads/[id]/ki/entwurf', laden: () => import('../app/api/leads/[id]/ki/entwurf/route') as never, methode: 'POST', mindestens: 'mitglied' },
  { name: 'settings', laden: () => import('../app/api/settings/route') as never, methode: 'PUT', mindestens: 'admin', body: {} },
  { name: 'settings/ki-schluessel PUT', laden: () => import('../app/api/settings/ki-schluessel/route') as never, methode: 'PUT', mindestens: 'admin', body: { anbieter: 'openai', schluessel: 'sk-test-1234567890' } },
  { name: 'settings/ki-schluessel DELETE', laden: () => import('../app/api/settings/ki-schluessel/route') as never, methode: 'DELETE', mindestens: 'admin', body: { anbieter: 'openai' } },
  { name: 'settings/ki-schluessel/test', laden: () => import('../app/api/settings/ki-schluessel/test/route') as never, methode: 'POST', mindestens: 'admin', body: { anbieter: 'openai' } },
  { name: 'absender/[id]', laden: () => import('../app/api/absender/[id]/route') as never, methode: 'DELETE', mindestens: 'admin' },
  { name: 'absender', laden: () => import('../app/api/absender/route') as never, methode: 'POST', mindestens: 'admin', body: { email: 'x@y.de' } },
  { name: 'absender/verbindungstest', laden: () => import('../app/api/absender/verbindungstest/route') as never, methode: 'POST', mindestens: 'admin', body: {} },
  { name: 'gmail/connect', laden: () => import('../app/api/gmail/connect/route') as never, methode: 'GET', mindestens: 'admin' },
  { name: 'webhooks', laden: () => import('../app/api/webhooks/route') as never, methode: 'POST', mindestens: 'admin', body: { url: 'https://x.de', ereignisse: ['antwort'] } },
  { name: 'webhooks/[id]/geheimnis', laden: () => import('../app/api/webhooks/[id]/geheimnis/route') as never, methode: 'GET', mindestens: 'admin' },
  { name: 'api-schluessel', laden: () => import('../app/api/api-schluessel/route') as never, methode: 'POST', mindestens: 'admin', body: { name: 'k', rechte: 'lesen' } },
  { name: 'api-schluessel/[id]', laden: () => import('../app/api/api-schluessel/[id]/route') as never, methode: 'DELETE', mindestens: 'admin' },
  { name: 'benutzer', laden: () => import('../app/api/benutzer/route') as never, methode: 'GET', mindestens: 'admin' },
  { name: 'benutzer/einladungen', laden: () => import('../app/api/benutzer/einladungen/route') as never, methode: 'POST', mindestens: 'admin', body: { email: 'q@x.de', rolle: 'admin' } },
  { name: 'benutzer/[id]', laden: () => import('../app/api/benutzer/[id]/route') as never, methode: 'PATCH', mindestens: 'admin', body: { rolle: 'admin' } },
];

describe('Rollenprüfung: Stichproben (403/401)', () => {
  for (const s of stichproben) {
    it(`${s.methode} ${s.name}: ohne Login 401, „lesen“ 403${s.mindestens === 'admin' ? ', „mitglied“ 403' : ''}`, async () => {
      const mod = await s.laden();
      const h = mod[s.methode];
      expect((await h(req(s.methode, null, s.body), id() as never)).status).toBe(401);
      expect((await h(req(s.methode, 'lesen', s.body), id() as never)).status).toBe(403);
      if (s.mindestens === 'admin') expect((await h(req(s.methode, 'mitglied', s.body), id() as never)).status).toBe(403);
      else expect((await h(req(s.methode, 'mitglied', s.body), id() as never)).status).not.toBe(403);
      // Gefälschte Header ändern nichts
      const spoof = { 'x-vo-rolle': 'admin', 'x-vo-benutzer': '0' };
      expect((await h(req(s.methode, 'lesen', s.body, spoof), id() as never)).status).toBe(403);
      expect((await h(req(s.methode, null, s.body, spoof), id() as never)).status).toBe(401);
    });
  }

  it('„lesen“ darf lesen und exportieren (GET campaigns, CSV-Export, Status)', async () => {
    const liste = await import('../app/api/campaigns/route');
    expect((await liste.GET(req('GET', 'lesen'))).status).toBe(200);
    const csv = await import('../app/api/campaigns/[id]/export.csv/route');
    const res = await csv.GET(req('GET', 'lesen'), id());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const status = await import('../app/api/campaigns/[id]/status/route');
    expect((await status.GET(req('GET', 'lesen'), id())).status).toBe(200);
    const settings = await import('../app/api/settings/route');
    expect((await settings.GET(req('GET', 'lesen'))).status).toBe(200);
  });

  it('„mitglied“ darf Kampagnen anlegen, „admin“ löschen', async () => {
    const liste = await import('../app/api/campaigns/route');
    const neu = await liste.POST(req('POST', 'mitglied', { name: 'Von Mitglied', ctaUrl: 'https://x.de' }));
    expect(neu.status).toBe(201);
    const neuId = (await neu.json()).id as number;
    const del = await import('../app/api/campaigns/[id]/route');
    expect((await del.DELETE(req('DELETE', 'mitglied'), { params: Promise.resolve({ id: String(neuId) }) })).status).toBe(403);
    expect((await del.DELETE(req('DELETE', 'admin'), { params: Promise.resolve({ id: String(neuId) }) })).status).toBe(200);
  });

  it('Rollen-Wrapper mitRolle für die KI-/Unibox-Handler', async () => {
    const { mitRolle } = await import('./session');
    const h = mitRolle('mitglied', async () => new Response('ok'));
    expect((await h(req('POST', 'lesen'))).status).toBe(403);
    expect((await h(req('POST', 'mitglied'))).status).toBe(200);
    expect((await h(req('POST', null))).status).toBe(401);
  });
});
