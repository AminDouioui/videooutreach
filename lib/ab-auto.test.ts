import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AB_MIN_GESENDET, bewerteVarianten, wilson } from './ab-auto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-ab-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

const z = (kuerzel: string, gesendet: number, antworten: number, aktiv = true) => ({ kuerzel, aktiv, gesendet, antworten });

describe('Wilson-Intervall', () => {
  it('liegt um den Anteil und wird mit mehr Daten enger', () => {
    const klein = wilson(20, 4);
    const gross = wilson(2000, 400);
    expect(klein.low).toBeLessThan(0.2);
    expect(klein.high).toBeGreaterThan(0.2);
    expect(gross.high - gross.low).toBeLessThan(klein.high - klein.low);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
    expect(wilson(50, 0).low).toBe(0);
  });
});

describe('bewerteVarianten', () => {
  it('schaltet eine deutlich schwächere Variante ab', () => {
    const b = bewerteVarianten([z('A', 100, 12), z('B', 100, 1)]);
    expect(b.fuehrend).toBe('A');
    expect(b.abschalten.map((x) => x.kuerzel)).toEqual(['B']);
    expect(b.abschalten[0].grund).toContain('Variante A');
  });
  it('wartet, bis genug gesendet wurde', () => {
    expect(bewerteVarianten([z('A', AB_MIN_GESENDET - 1, 20), z('B', 100, 0)]).abschalten).toEqual([]);
  });
  it('schaltet nichts ab, wenn der Unterschied nicht deutlich ist', () => {
    expect(bewerteVarianten([z('A', 50, 6), z('B', 50, 4)]).abschalten).toEqual([]);
  });
  it('Variante A wird nie abgeschaltet, nur gemeldet', () => {
    const b = bewerteVarianten([z('A', 100, 1), z('B', 100, 15)]);
    expect(b.abschalten).toEqual([]);
    expect(b.aUnterlegen?.kuerzel).toBe('A');
    expect(b.fuehrend).toBe('B');
  });
  it('bewertet nur aktive Varianten und braucht mindestens zwei', () => {
    expect(bewerteVarianten([z('A', 100, 10), z('B', 100, 0, false)]).abschalten).toEqual([]);
    expect(bewerteVarianten([z('A', 100, 10)]).fuehrend).toBeNull();
  });
  it('mehrere schwache Varianten gleichzeitig', () => {
    const b = bewerteVarianten([z('A', 120, 15), z('B', 120, 0), z('C', 120, 1), z('D', 120, 14)]);
    expect(b.abschalten.map((x) => x.kuerzel).sort()).toEqual(['B', 'C']);
  });
});

describe('Automatik (DB)', () => {
  let db: typeof import('./db');
  let ab: typeof import('./ab-auto-db');
  let nr = 0;
  beforeAll(async () => {
    db = await import('./db');
    ab = await import('./ab-auto-db');
  });
  function kampagne(extra: Partial<typeof import('../db/schema').campaigns.$inferInsert> = {}) {
    return db.getDb().insert(db.schema.campaigns).values({ name: `AB${++nr}`, ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b', status: 'versendet_laufend', abAuto: true, ...extra }).returning().get();
  }
  function leads(campaignId: number, variante: string, gesendet: number, beantwortet: number) {
    for (let i = 0; i < gesendet; i++) {
      db.getDb().insert(db.schema.leads).values({ campaignId, firma: `F${campaignId}${variante}${i}`, email: `${variante}${i}-${campaignId}@f.de`, slug: `ab-${campaignId}-${variante}-${i}`, sendStatus: 'gesendet', variante, flowStopp: i < beantwortet ? 'beantwortet' : null }).run();
    }
  }
  const variante = (campaignId: number, kuerzel: string) => db.getDb().insert(db.schema.varianten).values({ campaignId, kuerzel, betreff: 'b', text: 't' }).run();
  const aktiv = (campaignId: number, kuerzel: string) => db.getDb().select().from(db.schema.varianten).where(eq(db.schema.varianten.campaignId, campaignId)).all().find((v) => v.kuerzel === kuerzel)?.aktiv;

  it('schaltet die schwache Variante ab, protokolliert und wiederholt sich nicht', () => {
    const k = kampagne();
    variante(k.id, 'B');
    leads(k.id, 'A', 100, 14);
    leads(k.id, 'B', 100, 1);
    const jetzt = new Date('2026-10-21T10:00:00Z');
    expect(ab.wendeAbAutomatikAn(k.id, jetzt)).toMatchObject({ abgeschaltet: ['B'], aUnterlegen: false });
    expect(aktiv(k.id, 'B')).toBe(false);
    const log = db.getDb().select().from(db.schema.campaigns).where(eq(db.schema.campaigns.id, k.id)).get()!.abAutoLog!;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kuerzel: 'B', at: jetzt.getTime() });
    expect(ab.wendeAbAutomatikAn(k.id, jetzt).abgeschaltet).toEqual([]);
  });

  it('meldet eine unterlegene Variante A genau einmal und lässt sie aktiv', () => {
    const k = kampagne();
    variante(k.id, 'B');
    leads(k.id, 'A', 100, 1);
    leads(k.id, 'B', 100, 15);
    expect(ab.wendeAbAutomatikAn(k.id).aUnterlegen).toBe(true);
    expect(ab.wendeAbAutomatikAn(k.id).aUnterlegen).toBe(false);
    expect(aktiv(k.id, 'B')).toBe(true);
    expect(db.getDb().select().from(db.schema.campaigns).where(eq(db.schema.campaigns.id, k.id)).get()!.abAutoLog).toHaveLength(1);
  });

  it('abAutomatik: nur laufende Kampagnen mit Schalter, höchstens stündlich', () => {
    ab.setzeAbDrosselungZurueck();
    const an = kampagne();
    const aus = kampagne({ abAuto: false });
    const pausiert = kampagne({ status: 'pausiert' });
    for (const k of [an, aus, pausiert]) {
      variante(k.id, 'B');
      leads(k.id, 'A', 100, 14);
      leads(k.id, 'B', 100, 0);
    }
    const t = new Date('2026-10-21T12:00:00Z');
    const r = ab.abAutomatik(t);
    expect(r.map((x) => x.campaignId)).toContain(an.id);
    expect(r.map((x) => x.campaignId)).not.toContain(aus.id);
    expect(r.map((x) => x.campaignId)).not.toContain(pausiert.id);
    expect(aktiv(aus.id, 'B')).toBe(true);
    expect(ab.abAutomatik(new Date(t.getTime() + 60_000))).toEqual([]); // gedrosselt
  });
});
