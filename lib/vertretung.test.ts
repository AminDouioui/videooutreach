import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-vertretung-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SENDER_EMAIL: 'amin@prozessia.de',
});

type Mods = { db: typeof import('./db'); v: typeof import('./vertretung'); send: typeof import('./send'); settings: typeof import('./settings') };
let m: Mods;
let nr = 0;

const IM_ZEITRAUM = new Date('2026-10-27T10:00:00Z');
const DAVOR = new Date('2026-10-23T10:00:00Z');
const DANACH = new Date('2026-11-01T10:00:00Z');

function neuerLead() {
  const { getDb, schema } = m.db;
  nr++;
  const k = getDb().insert(schema.campaigns).values({ name: `K${nr}`, ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo', emailBodyTemplate: 'x' }).returning().get();
  return getDb()
    .insert(schema.leads)
    .values({ campaignId: k.id, firma: `Firma ${nr}`, email: `f${nr}@kunde.de`, slug: `vt-${nr}`, gmailThreadId: `t${nr}`, sendStatus: 'gesendet' })
    .returning()
    .get();
}
const entwurf = (leadId: number) => m.db.getDb().select().from(m.db.schema.vertretungsEntwuerfe).where(eq(m.db.schema.vertretungsEntwuerfe.leadId, leadId)).get();

beforeAll(async () => {
  m = { db: await import('./db'), v: await import('./vertretung'), send: await import('./send'), settings: await import('./settings') };
  m.db.getDb();
});

describe('klassifiziereVertretung', () => {
  it('erkennt technische Probleme', () => {
    expect(m.v.klassifiziereVertretung('Re: Video', 'Das Video funktioniert nicht bei uns')).toBe('technik');
    expect(m.v.klassifiziereVertretung('', 'Der Link geht nicht, Fehler im Browser')).toBe('technik');
  });
  it('alles andere ist eine Firmenangelegenheit', () => {
    expect(m.v.klassifiziereVertretung('Re: Ihre Anfrage', 'Gern, rufen Sie mich morgen an.')).toBe('firma');
  });
});

describe('Vertretungszeitraum', () => {
  it('schließt beide Tage ein und beachtet die Berliner Zeit', () => {
    const k = { aktiv: true, von: '2026-10-24', bis: '2026-10-31' };
    expect(m.v.imVertretungszeitraum(k, new Date('2026-10-24T00:30:00+02:00'))).toBe(true);
    expect(m.v.imVertretungszeitraum(k, new Date('2026-10-31T23:30:00+01:00'))).toBe(true);
    expect(m.v.imVertretungszeitraum(k, DAVOR)).toBe(false);
    expect(m.v.imVertretungszeitraum(k, DANACH)).toBe(false);
    expect(m.v.imVertretungszeitraum({ ...k, aktiv: false }, IM_ZEITRAUM)).toBe(false);
  });
});

describe('erstelleVertretungsEntwurf', () => {
  it('legt im Zeitraum genau einen Entwurf an die Firmen-Ansprechperson an', async () => {
    const l = neuerLead();
    const id = await m.v.erstelleVertretungsEntwurf(l.id, IM_ZEITRAUM);
    expect(id).toBeGreaterThan(0);
    expect(await m.v.erstelleVertretungsEntwurf(l.id, IM_ZEITRAUM)).toBeNull();
    const e = entwurf(l.id)!;
    expect(e).toMatchObject({ kategorie: 'firma', an: 'c.maclaren@haveraustralia.com.au', erledigtAt: null });
    expect(e.text).toContain(l.firma);
    expect(e.text).toContain(`https://video.example.de/antworten?lead=${l.id}`);
  });

  it('legt außerhalb des Zeitraums nichts an', async () => {
    const l = neuerLead();
    expect(await m.v.erstelleVertretungsEntwurf(l.id, DAVOR)).toBeNull();
    expect(await m.v.erstelleVertretungsEntwurf(l.id, DANACH)).toBeNull();
    expect(entwurf(l.id)).toBeUndefined();
  });

  it('wird beim Erkennen einer Antwort ausgelöst, bei Bounce nicht', async () => {
    const a = neuerLead();
    const b = neuerLead();
    expect(await m.send.pruefeAntwort(a, async () => 'antwort', IM_ZEITRAUM, { id: 1, email: 'amin@prozessia.de', typ: 'gmail' } as never)).toBe(true);
    expect(entwurf(a.id)).toBeDefined();
    await m.send.pruefeAntwort(b, async () => 'bounce', IM_ZEITRAUM, { id: 1, email: 'amin@prozessia.de', typ: 'gmail' } as never);
    expect(entwurf(b.id)).toBeUndefined();
  });
});

describe('mailtoLink', () => {
  it('kodiert Betreff und Text und trennt Empfänger mit Komma', () => {
    const l = m.v.mailtoLink({ an: 'a@x.de, b@y.de', betreff: 'Hallo Welt', text: 'Zeile 1\nZeile 2' });
    expect(l).toBe('mailto:a@x.de,b@y.de?subject=Hallo%20Welt&body=Zeile%201%0AZeile%202');
  });
});
