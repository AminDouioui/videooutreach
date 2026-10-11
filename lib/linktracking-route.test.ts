import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-lc-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

type Mods = { db: typeof import('./db'); route: typeof import('../app/api/c/[token]/route'); lt: typeof import('./linktracking') };
let m: Mods;
let leadId = 0;
const MENSCH = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const get = (token: string, ua: string | null, query = '') =>
  m.route.GET(new Request(`https://video.example.de/api/c/${token}${query}`, { headers: ua ? { 'user-agent': ua } : {} }), { params: Promise.resolve({ token }) });
const events = () => m.db.getDb().select().from(m.db.schema.events).where(eq(m.db.schema.events.leadId, leadId)).all();
const score = () => m.db.getDb().select({ s: m.db.schema.leads.score }).from(m.db.schema.leads).where(eq(m.db.schema.leads.id, leadId)).get()!.s;

beforeAll(async () => {
  m = { db: await import('./db'), route: await import('../app/api/c/[token]/route'), lt: await import('./linktracking') };
  const { getDb, schema } = m.db;
  const k = getDb().insert(schema.campaigns).values({ name: 'LC', ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b', linkTracking: true }).returning().get();
  leadId = getDb().insert(schema.leads).values({ campaignId: k.id, firma: 'F', email: 'a@f.de', slug: 'lc-1' }).returning().get().id;
});

describe('GET /api/c/[token]', () => {
  const tokenFuer = (url: string, slug = 'lc-1') => m.lt.erzeugeLinkToken('0'.repeat(64), slug, url)!;

  it('Mensch: 302 aufs Ziel, Event link_click mit meta.url, Score +10 (einmalig)', async () => {
    const res = await get(tokenFuer('https://ziel.de/a?b=1'), MENSCH);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://ziel.de/a?b=1');
    let ev = events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'link_click', isBot: false, meta: { url: 'https://ziel.de/a?b=1' } });
    expect(score()).toBe(10);
    await get(tokenFuer('https://ziel.de/b'), MENSCH);
    ev = events();
    expect(ev).toHaveLength(2);
    expect(score()).toBe(10);
  });
  it('Bot: Event mit isBot=true, trotzdem 302, kein Score', async () => {
    const vorher = events().length;
    const res = await get(tokenFuer('https://ziel.de/bot'), 'Mozilla/5.0 (compatible; Googlebot/2.1)');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://ziel.de/bot');
    const neu = events().slice(vorher);
    expect(neu).toHaveLength(1);
    expect(neu[0].isBot).toBe(true);
    expect(score()).toBe(10);
    // ohne User-Agent = Bot
    await get(tokenFuer('https://ziel.de/bot'), null);
    expect(events().at(-1)!.isBot).toBe(true);
  });
  it('?vorschau=1 leitet weiter, loggt aber nichts', async () => {
    const vorher = events().length;
    const res = await get(tokenFuer('https://ziel.de/v'), MENSCH, '?vorschau=1');
    expect(res.status).toBe(302);
    expect(events().length).toBe(vorher);
  });
  it('HEAD leitet weiter ohne Event', async () => {
    const vorher = events().length;
    const t = tokenFuer('https://ziel.de/h');
    const res = await m.route.HEAD(new Request(`https://video.example.de/api/c/${t}`, { method: 'HEAD' }), { params: Promise.resolve({ token: t }) });
    expect(res.status).toBe(302);
    expect(events().length).toBe(vorher);
  });
  it('unbekanntes, manipuliertes oder falsch signiertes Token: 404-Seite, kein Event', async () => {
    const vorher = events().length;
    for (const t of ['unbekannt', 'a.b', Buffer.from('lc-1\nhttps://boese.de', 'utf8').toString('base64url') + '.' + 'A'.repeat(22), m.lt.erzeugeLinkToken('1'.repeat(64), 'lc-1', 'https://boese.de')!]) {
      const res = await get(t, MENSCH);
      expect(res.status).toBe(404);
      expect(res.headers.get('location')).toBeNull();
      expect(await res.text()).toContain('Link nicht gefunden');
    }
    expect(events().length).toBe(vorher);
  });
  it('gültig signiert, aber Lead existiert nicht: Weiterleitung ohne Event', async () => {
    const res = await get(tokenFuer('https://ziel.de/x', 'geloescht'), MENSCH);
    expect(res.status).toBe(302);
  });
  it('Ratelimit: nach 30 Klicks je Token weiter 302, aber keine weiteren Events', async () => {
    const t = tokenFuer('https://ziel.de/limit');
    const vorher = events().length;
    for (let i = 0; i < 40; i++) expect((await get(t, MENSCH)).status).toBe(302);
    expect(events().length - vorher).toBe(30);
  });
});
