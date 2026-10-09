import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-ab-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SENDER_EMAIL: 'amin@prozessia.de',
});

type Mods = {
  db: typeof import('./db');
  send: typeof import('./send');
  stat: typeof import('./varianten-statistik');
  vdb: typeof import('./varianten-db');
};
let m: Mods;
let nr = 0;

function fakeSender() {
  const gesendet: { raw: string; threadId?: string }[] = [];
  const sender = async (raw: string, threadId?: string) => {
    gesendet.push({ raw: Buffer.from(raw, 'base64url').toString('utf8'), threadId });
    return { id: `m${gesendet.length}`, threadId: threadId ?? `t${gesendet.length}` };
  };
  return { gesendet, sender };
}

const subjectVon = (mime: string) => /^Subject: (.*)$/m.exec(mime)?.[1] ?? '';

function neueKampagne() {
  const { getDb, schema } = m.db;
  return getDb()
    .insert(schema.campaigns)
    .values({ name: 'AB', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Betreff A {{firma}}', emailBodyTemplate: 'Text A', mitVideo: false, status: 'versendet_laufend' })
    .returning()
    .all()[0];
}
function neuerLead(campaignId: number) {
  const { getDb, schema } = m.db;
  nr++;
  return getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `ab${nr}@kunde.de`, slug: `ab-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant' })
    .returning()
    .all()[0];
}
function neueVariante(campaignId: number, kuerzel: string, aktiv = true) {
  const { getDb, schema } = m.db;
  return getDb().insert(schema.varianten).values({ campaignId, kuerzel, betreff: `Betreff ${kuerzel} {{firma}}`, text: `Text ${kuerzel}`, aktiv }).returning().all()[0];
}

beforeAll(async () => {
  m = { db: await import('./db'), send: await import('./send'), stat: await import('./varianten-statistik'), vdb: await import('./varianten-db') };
  m.db.getDb();
});

describe('Versand mit Varianten', () => {
  it('ohne Zusatzvarianten: Vorlage der Kampagne, Variante A', async () => {
    const k = neueKampagne();
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    expect((await m.send.sendLead(l.id, { sender })).ok).toBe(true);
    expect(subjectVon(gesendet[0].raw)).toBe(`Betreff A ${l.firma}`);
    const neu = m.db.getDb().select().from(m.db.schema.leads).all().find((x) => x.id === l.id)!;
    expect(neu.variante).toBe('A');
  });

  it('rotiert gleichmäßig über aktive Varianten, inaktive bleiben außen vor', async () => {
    const k = neueKampagne();
    neueVariante(k.id, 'B');
    neueVariante(k.id, 'C', false);
    const { gesendet, sender } = fakeSender();
    const ids = [neuerLead(k.id).id, neuerLead(k.id).id, neuerLead(k.id).id, neuerLead(k.id).id];
    for (const id of ids) await m.send.sendLead(id, { sender });
    const subjects = gesendet.map((g) => subjectVon(g.raw).replace(/ Firma \d+$/, ''));
    expect(subjects).toEqual(['Betreff A', 'Betreff B', 'Betreff A', 'Betreff B']);
    expect(m.vdb.variantenZaehler(k.id)).toEqual({ A: 2, B: 2 });
  });

  it('Follow-up im Thread nutzt den Betreff der Variante des Leads', async () => {
    const k = neueKampagne();
    neueVariante(k.id, 'B');
    m.db.getDb().insert(m.db.schema.followups).values({ campaignId: k.id, position: 1, waitDays: 1, body: 'Nachgehakt' }).run();
    const a = neuerLead(k.id);
    const b = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    await m.send.sendLead(a.id, { sender });
    await m.send.sendLead(b.id, { sender });
    const pruefer = async () => null;
    await m.send.sendFollowup(a.id, { sender, pruefer });
    await m.send.sendFollowup(b.id, { sender, pruefer });
    expect(subjectVon(gesendet[2].raw)).toBe(`Re: Betreff A ${a.firma}`);
    expect(subjectVon(gesendet[3].raw)).toBe(`Re: Betreff B ${b.firma}`);
    expect(gesendet[3].threadId).toBe('t2');
  });

  it('Vorschau: Variante des Leads, sonst die kommende, optional explizit', () => {
    const k = neueKampagne();
    neueVariante(k.id, 'B');
    const l = neuerLead(k.id);
    expect(m.vdb.vorschauVariante(l, null)).toBe('A');
    expect(m.vdb.vorschauVariante(l, 'B')).toBe('B');
    expect(m.vdb.vorschauVariante({ ...l, variante: 'B' }, null)).toBe('B');
    expect(m.send.buildLeadEmail(l, k, undefined, 'B').subject).toBe(`Betreff B ${l.firma}`);
  });
});

describe('Statistik je Variante', () => {
  it('zählt gesendet, Ansicht, Play, Termin-Klick, Antworten (ohne Bots) und Raten', () => {
    const { getDb, schema } = m.db;
    const k = neueKampagne();
    neueVariante(k.id, 'B');
    const mk = (variante: string | null, extra: Partial<typeof schema.leads.$inferInsert> = {}) => {
      const l = neuerLead(k.id);
      getDb().update(schema.leads).set({ sendStatus: 'gesendet', variante, ...extra }).where(eq(schema.leads.id, l.id)).run();
      return l.id;
    };
    const ev = (leadId: number, type: (typeof schema.EVENT_TYPEN)[number], isBot = false) => getDb().insert(schema.events).values({ leadId, type, isBot }).run();

    const a1 = mk('A');
    const a2 = mk(null); // Altbestand ohne Kürzel = A
    const b1 = mk('B', { flowStopp: 'beantwortet' });
    mk('B');
    neuerLead(k.id); // nicht gesendet

    ev(a1, 'page_view');
    ev(a1, 'page_view');
    ev(a1, 'play');
    ev(a2, 'page_view', true); // Bot zählt nicht
    ev(b1, 'page_view');
    ev(b1, 'play');
    ev(b1, 'cta_click');

    const s = m.stat.ladeVariantenStatistik(k.id);
    expect(s.map((x) => x.kuerzel)).toEqual(['A', 'B']);
    expect(s[0]).toMatchObject({ gesendet: 2, angesehen: 1, play: 1, terminKlick: 0, antworten: 0, angesehenRate: 0.5 });
    expect(s[1]).toMatchObject({ gesendet: 2, angesehen: 1, play: 1, terminKlick: 1, antworten: 1, terminRate: 0.5, antwortRate: 0.5 });
  });

  it('liefert Raten 0 ohne Versand', () => {
    const k = neueKampagne();
    neueVariante(k.id, 'B');
    expect(m.stat.ladeVariantenStatistik(k.id).every((x) => x.gesendet === 0 && x.playRate === 0)).toBe(true);
  });
});
