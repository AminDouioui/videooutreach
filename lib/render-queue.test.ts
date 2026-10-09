import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-queue-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SENDER_EMAIL: 'amin@prozessia.de',
});

type Mods = { db: typeof import('./db'); queue: typeof import('./render-queue'); send: typeof import('./send') };
let m: Mods;
let nr = 0;

type NeuerLead = Partial<typeof import('@/db/schema').leads.$inferInsert>;

function neueKampagne(status: (typeof import('@/db/schema').KAMPAGNEN_STATUS)[number]) {
  const { getDb, schema } = m.db;
  const [k] = getDb()
    .insert(schema.campaigns)
    .values({ name: 'T', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo', emailBodyTemplate: 'Text', status })
    .returning()
    .all();
  return k;
}
function neuerLead(campaignId: number, extra: NeuerLead = {}) {
  const { getDb, schema } = m.db;
  nr++;
  const [l] = getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `l${nr}@x.de`, slug: `q-${nr}`, ...extra })
    .returning()
    .all();
  return l;
}
function lead(id: number) {
  const { getDb, schema } = m.db;
  return getDb().select().from(schema.leads).where(eq(schema.leads.id, id)).get()!;
}
function kampagne(id: number) {
  const { getDb, schema } = m.db;
  return getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get()!;
}

beforeAll(async () => {
  m = { db: await import('./db'), queue: await import('./render-queue'), send: await import('./send') };
  m.db.getDb();
});

describe('Rendern stoppen', () => {
  it('leert die Warteschlange, markiert laufende Jobs zum Abbruch und lässt fertige unberührt', () => {
    const k = neueKampagne('rendert');
    const wartend = neuerLead(k.id, { renderStatus: 'wartet', renderRequested: true });
    const laufend = neuerLead(k.id, { renderStatus: 'rendert', renderRequested: true });
    const fertig = neuerLead(k.id, { renderStatus: 'fertig', renderRequested: false });

    expect(m.queue.stoppeRender(k.id)).toBe(2);
    expect(lead(wartend.id)).toMatchObject({ renderStatus: 'wartet', renderRequested: false });
    expect(lead(laufend.id)).toMatchObject({ renderStatus: 'rendert', renderRequested: false });
    expect(lead(fertig.id).renderStatus).toBe('fertig');
    // Der laufende Job ist noch nicht abgebrochen -> Kampagne bleibt vorerst 'rendert'
    expect(kampagne(k.id).status).toBe('rendert');
    expect(m.queue.ladeKampagnenStatus(k.id)!.angefordert).toBe(1);
  });

  it('setzt die Kampagne auf bereit, wenn nichts mehr läuft', () => {
    const k = neueKampagne('rendert');
    neuerLead(k.id, { renderStatus: 'wartet', renderRequested: true });
    m.queue.stoppeRender(k.id);
    expect(kampagne(k.id).status).toBe('bereit');
    expect(m.queue.ladeKampagnenStatus(k.id)!.angefordert).toBe(0);
  });

  it('Fortsetzen reiht gestoppte Leads wieder ein und rettet einen noch laufenden Job vor dem Abbruch', () => {
    const k = neueKampagne('rendert');
    const wartend = neuerLead(k.id, { renderStatus: 'wartet', renderRequested: true });
    const laufend = neuerLead(k.id, { renderStatus: 'rendert', renderRequested: true });
    m.queue.stoppeRender(k.id);

    expect(m.queue.fordereRenderAn(k.id, 'all')).toBe(1);
    expect(lead(wartend.id).renderRequested).toBe(true);
    expect(lead(laufend.id).renderRequested).toBe(true);
    expect(kampagne(k.id).status).toBe('rendert');
  });

  it('berührt andere Kampagnen nicht', () => {
    const a = neueKampagne('rendert');
    const b = neueKampagne('rendert');
    neuerLead(a.id, { renderStatus: 'wartet', renderRequested: true });
    const fremd = neuerLead(b.id, { renderStatus: 'wartet', renderRequested: true });
    m.queue.stoppeRender(a.id);
    expect(lead(fremd.id).renderRequested).toBe(true);
  });
});

describe('Versand abbrechen', () => {
  it('nimmt geplante Leads aus der Planung, lässt gesendete unberührt und setzt die Kampagne auf bereit', () => {
    const k = neueKampagne('versendet_laufend');
    const geplant = neuerLead(k.id, { renderStatus: 'fertig', sendStatus: 'geplant' });
    const gesendet = neuerLead(k.id, { renderStatus: 'fertig', sendStatus: 'gesendet' });

    expect(m.send.brecheVersandAb(k.id)).toBe(1);
    expect(lead(geplant.id).sendStatus).toBe('nicht_gesendet');
    expect(lead(gesendet.id).sendStatus).toBe('gesendet');
    expect(kampagne(k.id).status).toBe('bereit');
  });

  it('setzt die Kampagne auf rendert, wenn noch Videos anstehen', () => {
    const k = neueKampagne('pausiert');
    neuerLead(k.id, { renderStatus: 'fertig', sendStatus: 'geplant' });
    neuerLead(k.id, { renderStatus: 'wartet', renderRequested: true });
    m.send.brecheVersandAb(k.id);
    expect(kampagne(k.id).status).toBe('rendert');
  });
});
