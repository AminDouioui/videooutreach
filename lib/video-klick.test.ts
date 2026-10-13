import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-vk-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

type Mods = {
  db: typeof import('./db');
  route: typeof import('../app/r/[slug]/route');
  vk: typeof import('./video-klick');
  tr: typeof import('./tracking');
  csv: typeof import('../app/api/campaigns/[id]/export.csv/route');
  mail: typeof import('./mail');
};
let m: Mods;
let kampagneId = 0;
let cookie = '';
const MENSCH = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const SAFELINKS = 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0) SafeLinks';
const TAG = 24 * 3600 * 1000;

function neuerLead(slug: string, sentAgo: number | null = TAG) {
  const { getDb, schema } = m.db;
  const l = getDb()
    .insert(schema.leads)
    .values({ campaignId: kampagneId, firma: `Firma ${slug}`, email: `${slug}@f.de`, slug, sendStatus: 'gesendet', sentAt: sentAgo === null ? null : new Date(Date.now() - sentAgo) })
    .returning()
    .get();
  return l.id;
}
const get = (slug: string, ua: string | null, query = '') =>
  m.route.GET(new Request(`https://video.example.de/r/${slug}${query}`, { headers: ua ? { 'user-agent': ua } : {} }), { params: Promise.resolve({ slug }) });
const events = (leadId: number) => m.db.getDb().select().from(m.db.schema.events).where(eq(m.db.schema.events.leadId, leadId)).all();
const score = (leadId: number) => m.db.getDb().select({ s: m.db.schema.leads.score }).from(m.db.schema.leads).where(eq(m.db.schema.leads.id, leadId)).get()!.s;
const ev = (leadId: number, type: (typeof import('../db/schema'))['EVENT_TYPEN'][number], at: Date, isBot = false) =>
  m.db.getDb().insert(m.db.schema.events).values({ leadId, type, isBot, createdAt: at }).run();

beforeAll(async () => {
  m = {
    db: await import('./db'),
    route: await import('../app/r/[slug]/route'),
    vk: await import('./video-klick'),
    tr: await import('./tracking'),
    csv: await import('../app/api/campaigns/[id]/export.csv/route'),
    mail: await import('./mail'),
  };
  const { getDb, schema } = m.db;
  kampagneId = getDb().insert(schema.campaigns).values({ name: 'VK', ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b' }).returning().get().id;
  const auth = await import('./auth');
  const b = getDb().insert(schema.benutzer).values({ email: 'a@x.de', name: 'a', passwortHash: '0'.repeat(32) + ':' + '0'.repeat(128), rolle: 'admin' }).returning().get();
  cookie = `vo_session=${await auth.createSessionToken('r'.repeat(32), Date.now(), { benutzerId: b.id, rolle: 'admin', version: b.sessionVersion })}`;
});

describe('GET /r/[slug]', () => {
  it('Mensch: 302 auf /v/slug, Event video_link_click, Score +3', async () => {
    const id = neuerLead('vk-mensch');
    const res = await get('vk-mensch', MENSCH);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/v/vk-mensch');
    expect(res.headers.get('set-cookie')).toBeNull();
    const e = events(id);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ type: 'video_link_click', isBot: false });
    expect(score(id)).toBe(3);
  });
  it('Bot-User-Agent (Safe Links, leer): trotzdem 302, isBot, kein Score', async () => {
    const id = neuerLead('vk-bot');
    expect((await get('vk-bot', SAFELINKS)).status).toBe(302);
    await get('vk-bot', null);
    const e = events(id);
    expect(e).toHaveLength(2);
    expect(e.every((x) => x.isBot)).toBe(true);
    expect(e[0].meta).toMatchObject({ grund: 'user-agent' });
    expect(score(id)).toBe(0);
  });
  it('Klick höchstens 60 s nach Versand = Bot (kurz-nach-versand), danach Mensch', async () => {
    const id = neuerLead('vk-frisch', 10_000);
    expect((await get('vk-frisch', MENSCH)).status).toBe(302);
    expect(events(id)[0]).toMatchObject({ isBot: true, meta: { grund: 'kurz-nach-versand' } });
    expect(score(id)).toBe(0);
    const spaet = neuerLead('vk-spaet', 61_000);
    await get('vk-spaet', MENSCH);
    expect(events(spaet)[0].isBot).toBe(false);
  });
  it('mehrere Klicks innerhalb von 2 s = Serie: beide Bot', async () => {
    const id = neuerLead('vk-serie');
    await get('vk-serie', MENSCH);
    await get('vk-serie', MENSCH);
    const e = events(id);
    expect(e).toHaveLength(2);
    expect(e.every((x) => x.isBot)).toBe(true);
    expect(e[1].meta).toMatchObject({ grund: 'serie' });
    expect(score(id)).toBe(0);
  });
  it('Serie über erfasseVideoKlick: Klick nach mehr als 2 s ist wieder ein Mensch', () => {
    const id = neuerLead('vk-abstand');
    const t0 = new Date(Date.now() - 60_000);
    m.vk.erfasseVideoKlick({ leadId: id, userAgent: MENSCH, ipHash: null, jetzt: t0 });
    const r = m.vk.erfasseVideoKlick({ leadId: id, userAgent: MENSCH, ipHash: null, jetzt: new Date(t0.getTime() + 3000) });
    expect(r).toEqual({ isBot: false, grund: null });
    expect(events(id).every((x) => !x.isBot)).toBe(true);
  });
  it('?vorschau=1: Weiterleitung ohne Event; HEAD ebenfalls', async () => {
    const id = neuerLead('vk-vorschau');
    expect((await get('vk-vorschau', MENSCH, '?vorschau=1')).status).toBe(302);
    const h = await m.route.HEAD(new Request('https://video.example.de/r/vk-vorschau', { method: 'HEAD' }), { params: Promise.resolve({ slug: 'vk-vorschau' }) });
    expect(h.status).toBe(302);
    expect(events(id)).toHaveLength(0);
  });
  it('unbekannter Slug: neutrale 404-Seite ohne Event, kein Hinweis auf Leads', async () => {
    const vorher = m.db.getDb().select().from(m.db.schema.events).all().length;
    const res = await get('gibt-es-nicht', MENSCH);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('Link nicht gefunden');
    expect(body).not.toContain('gibt-es-nicht');
    expect(res.headers.get('location')).toBeNull();
    expect(m.db.getDb().select().from(m.db.schema.events).all().length).toBe(vorher);
  });
});

describe('Mail-Link', () => {
  it('{{video_link}} und Vorschaubild laufen über /r/slug, Vorschau mit ?vorschau=1', () => {
    const lead = { slug: 'abc-123', firma: 'F' };
    const k = { emailSubjectTemplate: 's', emailBodyTemplate: '{{vorschaubild}}\n\n{{video_link}}', trackingPixel: false };
    const echt = m.mail.buildEmail(lead, k, { appUrl: 'https://video.example.de', signature: '' });
    expect(echt.html).toContain('<a href="https://video.example.de/r/abc-123"><img');
    expect(echt.text).toContain('Video ansehen: https://video.example.de/r/abc-123');
    expect(echt.html).not.toContain('/v/abc-123');
    const vorschau = m.mail.buildEmail(lead, k, { appUrl: 'https://video.example.de', signature: '', vorschau: true });
    expect(vorschau.html).toContain('/r/abc-123?vorschau=1');
  });
});

describe('Score', () => {
  it('video_link_click +3 nur ohne play, einmalig, kein Bot', async () => {
    const { berechneScore } = await import('./score');
    const e = (type: string, isBot = false) => ({ type, isBot, createdAt: new Date('2026-01-05T10:00:00Z') });
    expect(berechneScore([e('video_link_click')])).toBe(3);
    expect(berechneScore([e('video_link_click'), e('video_link_click')])).toBe(3);
    expect(berechneScore([e('video_link_click', true)])).toBe(0);
    expect(berechneScore([e('video_link_click'), e('play')])).toBe(10);
  });
});

describe('Kennzahlen (erste Zeiten) und CSV', () => {
  it('ladeLeadMetriken: erste/letzte Zeiten ohne Bots, videoGeklickt = früheres von Mail-Klick und Play', async () => {
    const id = neuerLead('vk-metrik');
    const t = (min: number) => new Date(Date.UTC(2026, 9, 13, 10, min, 0));
    ev(id, 'video_link_click', t(5), true); // Bot, zählt nicht
    ev(id, 'video_link_click', t(10));
    ev(id, 'play', t(12));
    ev(id, 'play', t(30));
    ev(id, 'play', t(1), true);
    ev(id, 'cta_click', t(20));
    ev(id, 'cta_click', t(40));
    ev(id, 'progress_50', t(25));
    const x = m.tr.ladeLeadMetriken(kampagneId).get(id)!;
    expect(x.mailKlickErster).toBe(t(10).getTime());
    expect(x.mailKlicks).toBe(1);
    expect(x.playErster).toBe(t(12).getTime());
    expect(x.terminErster).toBe(t(20).getTime());
    expect(x.terminLetzter).toBe(t(40).getTime());
    expect(x.maxProgress).toBe(50);
    expect(m.tr.videoGeklicktZeit(x)).toBe(t(10).getTime());
    // nur Play: videoGeklickt = Play
    expect(m.tr.videoGeklicktZeit({ mailKlickErster: null, playErster: 5 })).toBe(5);
    expect(m.tr.videoGeklicktZeit({ mailKlickErster: 9, playErster: 5 })).toBe(5);
    expect(m.tr.videoGeklicktZeit({ mailKlickErster: null, playErster: null })).toBeNull();
    expect(m.tr.videoGeklicktZeit(undefined)).toBeNull();
  });
  it('letzte Aktivitäten: nur Nicht-Bot-Klicks/-Plays/-Termine, neueste zuerst', () => {
    const a = m.tr.ladeLetzteAktivitaeten(100);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((x) => ['video_link_click', 'play', 'cta_click'].includes(x.type))).toBe(true);
    const zeiten = a.map((x) => x.zeit);
    expect(zeiten).toEqual([...zeiten].sort((p, q) => q - p));
    expect(m.tr.ladeLetzteAktivitaeten(2)).toHaveLength(2);
  });
  it('CSV enthält die Zeitspalten (Europe/Berlin)', async () => {
    const res = await m.csv.GET(new Request('https://video.example.de/api/x', { headers: { cookie } }), { params: Promise.resolve({ id: String(kampagneId) }) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const [kopf, ...zeilen] = csv.replace('﻿', '').trim().split('\r\n');
    const spalten = kopf.split(';');
    for (const s of ['Video geklickt', 'Video gestartet', 'Termin geklickt', 'Mail-Klicks']) expect(spalten).toContain(s);
    const z = zeilen.find((r) => r.startsWith('Firma vk-metrik'))!.split(';');
    expect(z[spalten.indexOf('Video geklickt')]).toBe('13.10.26, 12:10'); // 10:10 UTC = 12:10 MESZ
    expect(z[spalten.indexOf('Video gestartet')]).toBe('13.10.26, 12:12');
    expect(z[spalten.indexOf('Termin geklickt')]).toBe('13.10.26, 12:20');
    expect(z[spalten.indexOf('Mail-Klicks')]).toBe('1');
    const leer = zeilen.find((r) => r.startsWith('Firma vk-abstand'))!.split(';');
    expect(leer[spalten.indexOf('Termin geklickt')]).toBe('');
  });
});
