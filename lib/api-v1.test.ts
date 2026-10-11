import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPublicPath } from './auth';

// MX-Prüfung ohne echtes DNS: jede Domain nimmt Mails an, außer „keinmx.de“
vi.mock('./mx', async (orig) => {
  const o = await orig<typeof import('./mx')>();
  return { ...o, pruefeDomains: async (domains: Iterable<string>) => new Map([...domains].map((d) => [d, d === 'keinmx.de' ? 'kein_mx' : 'ok'])) };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-api-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

type Mods = {
  db: typeof import('./db');
  key: typeof import('./api-schluessel');
  kampagnen: typeof import('../app/api/v1/kampagnen/route');
  kampagne: typeof import('../app/api/v1/kampagnen/[id]/route');
  kLeads: typeof import('../app/api/v1/kampagnen/[id]/leads/route');
  lead: typeof import('../app/api/v1/leads/[id]/route');
  us: typeof import('./untersequenzen-db');
  wh: typeof import('./webhooks');
};
let m: Mods;
let lesen = '';
let schreiben = '';
let kid = 0;
let nr = 0;

const req = (url: string, init: { method?: string; key?: string | null; body?: unknown; raw?: string } = {}) =>
  new Request(`https://video.example.de${url}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), 'content-type': 'application/json' },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
const kampagne = (extra: Partial<typeof import('@/db/schema').campaigns.$inferInsert> = {}) => {
  nr++;
  return m.db.getDb().insert(m.db.schema.campaigns).values({ name: `API-Kampagne ${nr}`, ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b', ...extra }).returning().get();
};
const leadsVon = (campaignId: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.campaignId, campaignId)).all();

beforeAll(async () => {
  m = {
    db: await import('./db'),
    key: await import('./api-schluessel'),
    kampagnen: await import('../app/api/v1/kampagnen/route'),
    kampagne: await import('../app/api/v1/kampagnen/[id]/route'),
    kLeads: await import('../app/api/v1/kampagnen/[id]/leads/route'),
    lead: await import('../app/api/v1/leads/[id]/route'),
    us: await import('./untersequenzen-db'),
    wh: await import('./webhooks'),
  };
  m.db.getDb();
  lesen = m.key.legeSchluesselAn('Nur lesen', 'lesen').schluessel;
  schreiben = m.key.legeSchluesselAn('Schreiben', 'schreiben').schluessel;
  kid = kampagne().id;
});

beforeEach(() => m.key.setzeApiLimitZurueck());

describe('Schlüssel', () => {
  it('Format vo_…, nur Hash und Präfix gespeichert', () => {
    expect(lesen).toMatch(/^vo_[A-Za-z0-9_-]{43}$/);
    const e = m.key.listeSchluessel().find((k) => k.name === 'Nur lesen')!;
    expect(e.praefix).toBe(lesen.slice(0, 8));
    expect(e.hash).toBe(m.key.hashSchluessel(lesen));
    expect(JSON.stringify(e)).not.toContain(lesen);
  });
  it('/api/v1 ist von der Session-Prüfung ausgenommen, /api/webhooks nicht', () => {
    expect(isPublicPath('/api/v1/kampagnen')).toBe(true);
    expect(isPublicPath('/api/v1/leads/3')).toBe(true);
    expect(isPublicPath('/api/webhooks')).toBe(false);
    expect(isPublicPath('/api/api-schluessel')).toBe(false);
    expect(isPublicPath('/api/v1')).toBe(false);
  });
});

describe('Authentifizierung', () => {
  it('ohne Schlüssel 401, falscher Schlüssel 401, falsches Schema 401', async () => {
    for (const r of [req('/api/v1/kampagnen'), req('/api/v1/kampagnen', { key: 'vo_falsch' }), new Request('https://x/api/v1/kampagnen', { headers: { authorization: `Basic ${lesen}` } })]) {
      const res = await m.kampagnen.GET(r);
      expect(res.status).toBe(401);
      expect(Object.keys(await res.json())).toEqual(['fehler']);
    }
  });
  it('gültiger Schlüssel: 200 und letzte Nutzung wird gesetzt', async () => {
    const vorher = m.key.listeSchluessel().find((k) => k.name === 'Nur lesen')!;
    expect(vorher.letzteNutzungAt).toBeNull();
    const res = await m.kampagnen.GET(req('/api/v1/kampagnen', { key: lesen }));
    expect(res.status).toBe(200);
    expect(m.key.listeSchluessel().find((k) => k.name === 'Nur lesen')!.letzteNutzungAt).not.toBeNull();
  });
  it('widerrufener Schlüssel 401', async () => {
    const { schluessel, eintrag } = m.key.legeSchluesselAn('Wegwerf', 'schreiben');
    expect((await m.kampagnen.GET(req('/api/v1/kampagnen', { key: schluessel }))).status).toBe(200);
    expect(m.key.widerrufeSchluessel(eintrag.id)).toBe(true);
    const res = await m.kampagnen.GET(req('/api/v1/kampagnen', { key: schluessel }));
    expect(res.status).toBe(401);
    expect((await res.json()).fehler).toContain('widerrufen');
  });
  it('Leserechte reichen nicht zum Schreiben (403), Schreiben darf auch lesen', async () => {
    expect((await m.kLeads.POST(req(`/api/v1/kampagnen/${kid}/leads`, { method: 'POST', key: lesen, body: { firma: 'A', email: 'a@a.de' } }), ctx(kid))).status).toBe(403);
    expect((await m.lead.PATCH(req('/api/v1/leads/1', { method: 'PATCH', key: lesen, body: { notizen: 'x' } }), ctx(1))).status).toBe(403);
    expect((await m.kampagnen.GET(req('/api/v1/kampagnen', { key: schreiben }))).status).toBe(200);
  });
  it('Ratelimit je Schlüssel: 429 nach 120 Anfragen', async () => {
    const { schluessel } = m.key.legeSchluesselAn('Limit', 'lesen');
    let letzte = 200;
    for (let i = 0; i < 121; i++) letzte = (await m.kampagnen.GET(req('/api/v1/kampagnen', { key: schluessel }))).status;
    expect(letzte).toBe(429);
    // anderer Schlüssel unberührt
    expect((await m.kampagnen.GET(req('/api/v1/kampagnen', { key: lesen }))).status).toBe(200);
  });
});

describe('Lesen', () => {
  it('Kampagnenliste und -detail, 404 bei unbekannt, keine Secrets', async () => {
    const liste = await (await m.kampagnen.GET(req('/api/v1/kampagnen', { key: lesen }))).json();
    expect(liste.kampagnen.find((k: { id: number }) => k.id === kid)).toMatchObject({ id: kid, leadAnzahl: 0 });
    const d = await m.kampagne.GET(req(`/api/v1/kampagnen/${kid}`, { key: lesen }), ctx(kid));
    expect(d.status).toBe(200);
    expect((await d.json()).kampagne.id).toBe(kid);
    expect((await m.kampagne.GET(req('/api/v1/kampagnen/9999', { key: lesen }), ctx(9999))).status).toBe(404);
    expect((await m.kampagne.GET(req('/api/v1/kampagnen/abc', { key: lesen }), ctx('abc'))).status).toBe(404);
  });
  it('Leads seitenweise mit Statusfilter; Fehler bei ungültigen Parametern', async () => {
    const k = kampagne();
    const { getDb, schema } = m.db;
    for (let i = 0; i < 55; i++) getDb().insert(schema.leads).values({ campaignId: k.id, firma: `F${i}`, email: `l${i}@pg.de`, slug: `pg-${k.id}-${i}`, leadStatus: i < 3 ? 'interessiert' : 'offen' }).run();
    const get = async (q: string) => m.kLeads.GET(req(`/api/v1/kampagnen/${k.id}/leads${q}`, { key: lesen }), ctx(k.id));
    const s1 = await (await get('')).json();
    expect(s1).toMatchObject({ seite: 1, gesamt: 55, seiten: 2 });
    expect(s1.leads).toHaveLength(50);
    expect((await (await get('?seite=2')).json()).leads).toHaveLength(5);
    const f = await (await get('?status=interessiert')).json();
    expect(f.gesamt).toBe(3);
    expect((await get('?seite=0')).status).toBe(400);
    expect((await get('?status=quatsch')).status).toBe(400);
    expect((await m.kLeads.GET(req('/api/v1/kampagnen/9999/leads', { key: lesen }), ctx(9999))).status).toBe(404);
    const text = JSON.stringify(s1);
    expect(text).not.toMatch(/refresh|token|geheimnis|hash|passwor/i);
  });
  it('einzelner Lead', async () => {
    const k = kampagne();
    const l = m.db.getDb().insert(m.db.schema.leads).values({ campaignId: k.id, firma: 'Solo', email: 'solo@solo.de', slug: 'solo-1', dealWert: 123450 }).returning().get();
    const res = await m.lead.GET(req(`/api/v1/leads/${l.id}`, { key: lesen }), ctx(l.id));
    expect(res.status).toBe(200);
    expect((await res.json()).lead).toMatchObject({ id: l.id, firma: 'Solo', dealWert: 1234.5, videoLink: 'https://video.example.de/v/solo-1', leadStatus: 'offen' });
    expect((await m.lead.GET(req('/api/v1/leads/99999', { key: lesen }), ctx(99999))).status).toBe(404);
  });
});

describe('Leads anlegen', () => {
  const post = (id: number, body: unknown, key: string | null = schreiben) => m.kLeads.POST(req(`/api/v1/kampagnen/${id}/leads`, { method: 'POST', key, body }), ctx(id));

  it('einzelner Lead und mehrere Leads inkl. Ausschlüssen mit Gründen', async () => {
    const k = kampagne();
    m.db.getDb().insert(m.db.schema.suppressionList).values([{ email: 'gesperrt@sperr.de', reason: 'test' }, { email: '@domain-weg.de', reason: 'test' }]).run();
    m.db.getDb().insert(m.db.schema.leads).values({ campaignId: k.id, firma: 'Alt', email: 'schon@da.de', slug: 'alt-1' }).run();

    const einzeln = await post(k.id, { firma: 'Einzel GmbH', email: 'Chef@Einzel.de', name: 'Max Mustermann', stadt: 'Köln' });
    expect(einzeln.status).toBe(201);
    expect((await einzeln.json()).angelegt).toBe(1);

    const res = await post(k.id, {
      leads: [
        { firma: 'Gut AG', email: 'gut@gut.de', vorname: 'Gitte', nachname: 'Gut', website: 'https://gut.co.uk' },
        { firma: 'Gut AG Zwei', email: 'GUT@gut.de' },
        { firma: 'Kaputt', email: 'kein-email' },
        { firma: '', email: 'ohne@firma.de' },
        { firma: 'Gesperrt', email: 'gesperrt@sperr.de' },
        { firma: 'Domain', email: 'x@domain-weg.de' },
        { firma: 'Schon da', email: 'schon@da.de' },
        { firma: 'Ohne MX', email: 'x@keinmx.de' },
        { firma: 'Zeitzone', email: 'tz@tz.de', zeitzone: 'America/New_York' },
      ],
    });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.angelegt).toBe(2);
    expect(j.uebersprungen).toBe(7);
    expect(j.ergebnisse.map((e: { code?: string }) => e.code)).toEqual([undefined, 'duplikat_datei', 'ungueltige_email', 'fehlende_pflichtfelder', 'gesperrt', 'gesperrt', 'duplikat_bestand', 'kein_mx', undefined]);
    expect(j.ergebnisse[1].grund).toBeTruthy();
    const alle = leadsVon(k.id);
    const gut = alle.find((l) => l.email === 'gut@gut.de')!;
    expect(gut).toMatchObject({ firma: 'Gut AG', vorname: 'Gitte', renderStatus: 'wartet', sendStatus: 'nicht_gesendet' });
    expect(gut.zeitzone).toBe('Europe/London');
    expect(alle.find((l) => l.email === 'tz@tz.de')!.zeitzone).toBe('America/New_York');
    const e = alle.find((l) => l.email === 'chef@einzel.de')!;
    expect(e).toMatchObject({ vorname: 'Max', nachname: 'Mustermann', extra: { stadt: 'Köln' } });
    // alle Slugs eindeutig
    expect(new Set(alle.map((l) => l.slug)).size).toBe(alle.length);
  });

  it('wiederholtes Senden erzeugt keine Duplikate', async () => {
    const k = kampagne();
    await post(k.id, { firma: 'Zweimal', email: 'z@zweimal.de' });
    const r = await post(k.id, { firma: 'Zweimal', email: 'z@zweimal.de' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ angelegt: 0, uebersprungen: 1 });
    expect(leadsVon(k.id)).toHaveLength(1);
  });

  it('Fehlerfälle', async () => {
    const k = kampagne();
    expect((await post(99999, { firma: 'A', email: 'a@a.de' })).status).toBe(404);
    expect((await post(k.id, {})).status).toBe(400);
    expect((await post(k.id, { leads: [] })).status).toBe(400);
    expect((await post(k.id, [{ firma: 'A' }])).status).toBe(400);
    expect((await m.kLeads.POST(req(`/api/v1/kampagnen/${k.id}/leads`, { method: 'POST', key: schreiben, raw: '{kaputt' }), ctx(k.id))).status).toBe(400);
    const ohneKey = await post(k.id, { firma: 'A', email: 'a@a.de' }, null);
    expect(ohneKey.status).toBe(401);
    expect(leadsVon(k.id)).toHaveLength(0);
  });
});

describe('PATCH /api/v1/leads/{id}', () => {
  const patch = (id: number, body: unknown, key: string | null = schreiben) => m.lead.PATCH(req(`/api/v1/leads/${id}`, { method: 'PATCH', key, body }), ctx(id));

  it('setzt Status, Notizen und Deal-Wert; Flow-Stopp greift und Webhook wird ausgelöst', async () => {
    const hook = m.wh.legeWebhookAn('https://hooks.example.com/', ['lead_status']);
    const k = kampagne();
    const l = m.db.getDb().insert(m.db.schema.leads).values({ campaignId: k.id, firma: 'P', email: 'p@p.de', slug: 'patch-1', sendStatus: 'gesendet' }).returning().get();
    const res = await patch(l.id, { leadStatus: 'nicht_interessiert', notizen: '  ruft zurück ', dealWert: '1.234,50 €' });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.lead).toMatchObject({ leadStatus: 'nicht_interessiert', notizen: 'ruft zurück', dealWert: 1234.5, flowStopp: 'status' });
    const z = m.db.getDb().select().from(m.db.schema.webhookZustellungen).where(eq(m.db.schema.webhookZustellungen.webhookId, hook.id)).all();
    expect(z).toHaveLength(1);
    m.db.getDb().delete(m.db.schema.webhooks).run();
  });

  it('löst die Untersequenz aus', async () => {
    const quelle = kampagne();
    const ziel = kampagne();
    expect(m.us.legeRegelAn(quelle.id, 'spaeter', ziel.id).ok).toBe(true);
    const l = m.db.getDb().insert(m.db.schema.leads).values({ campaignId: quelle.id, firma: 'Sub', email: 'sub@sub.de', slug: 'sub-1', sendStatus: 'gesendet' }).returning().get();
    expect((await patch(l.id, { leadStatus: 'spaeter' })).status).toBe(200);
    const kopie = leadsVon(ziel.id);
    expect(kopie).toHaveLength(1);
    expect(kopie[0]).toMatchObject({ email: 'sub@sub.de', herkunftLeadId: l.id });
  });

  it('Validierung: unbekannter Status, falscher Deal-Wert, leerer Body, fremde Felder, unbekannter Lead', async () => {
    const k = kampagne();
    const l = m.db.getDb().insert(m.db.schema.leads).values({ campaignId: k.id, firma: 'V', email: 'v@v.de', slug: 'val-1' }).returning().get();
    expect((await patch(l.id, { leadStatus: 'quatsch' })).status).toBe(400);
    expect((await patch(l.id, { dealWert: 'viel' })).status).toBe(400);
    expect((await patch(l.id, {})).status).toBe(400);
    expect((await patch(l.id, { email: 'neu@neu.de' })).status).toBe(400);
    expect((await patch(99999, { notizen: 'x' })).status).toBe(404);
    expect((await patch(l.id, { notizen: 'x' }, null)).status).toBe(401);
    const ok = await patch(l.id, { dealWert: null, notizen: null });
    expect(ok.status).toBe(200);
    expect((await ok.json()).lead).toMatchObject({ dealWert: null, notizen: null });
  });
});
