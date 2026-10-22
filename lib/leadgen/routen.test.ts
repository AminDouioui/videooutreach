import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-leadgen-routen-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'r'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's', APP_URL: 'https://video.example.de' });

const cookies: Record<'admin' | 'mitglied' | 'lesen', string> = { admin: '', mitglied: '', lesen: '' };

beforeAll(async () => {
  const db = await import('@/lib/db');
  const auth = await import('@/lib/auth');
  const ph = '0'.repeat(32) + ':' + '0'.repeat(128);
  for (const rolle of ['admin', 'mitglied', 'lesen'] as const) {
    const b = db.getDb().insert(db.schema.benutzer).values({ email: `${rolle}@x.de`, name: rolle, passwortHash: ph, rolle }).returning().get();
    cookies[rolle] = `vo_session=${await auth.createSessionToken('r'.repeat(32), Date.now(), { benutzerId: b.id, rolle, version: b.sessionVersion })}`;
  }
});

const req = (methode: string, rolle: keyof typeof cookies | null, body?: unknown, url = 'https://video.example.de/api/leadgen/x') =>
  new Request(url, { method: methode, headers: { 'content-type': 'application/json', ...(rolle ? { cookie: cookies[rolle] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

describe('Lauf starten und abfragen', () => {
  it('Start nur ab Rolle „mitglied“; ohne Login 401', async () => {
    const { POST } = await import('../../app/api/leadgen/runs/route');
    expect((await POST(req('POST', null, { filter: {} }))).status).toBe(401);
    expect((await POST(req('POST', 'lesen', { filter: {} }))).status).toBe(403);
  });

  it('ungültiger Filter → 400, gültiger → 201 mit Lauf-ID und Hinweisen zu fehlenden Diensten', async () => {
    const { POST, GET } = await import('../../app/api/leadgen/runs/route');
    const schlecht = await POST(req('POST', 'mitglied', { filter: { plzPraefixe: ['abc'] } }));
    expect(schlecht.status).toBe(400);
    expect((await schlecht.json()).error).toMatch(/Ungültige Eingabe/);
    const ok = await POST(req('POST', 'mitglied', { filter: { branchen: ['werkzeugbau'], mitarbeiterMin: 100, mitarbeiterMax: 800 } }));
    expect(ok.status).toBe(201);
    const data = await ok.json();
    expect(data.id).toBeGreaterThan(0);
    expect(data.voraussetzungen.hinweise.join(' ')).toMatch(/Brave/);
    const liste = await (await GET(req('GET', 'lesen'))).json();
    expect(liste[0]).toMatchObject({ id: data.id, status: 'laeuft', firmen: 0 });
  });

  it('Status, Ergebnisse und CSV eines Laufs; unbekannter Lauf → 404', async () => {
    const { GET: status } = await import('../../app/api/leadgen/runs/[id]/route');
    const { GET: ergebnisse } = await import('../../app/api/leadgen/runs/[id]/ergebnisse/route');
    const { GET: csv } = await import('../../app/api/leadgen/runs/[id]/export.csv/route');
    const s = await status(req('GET', 'lesen'), idCtx(1));
    expect(s.status).toBe(200);
    expect((await s.json()).stufen.map((x: { stufe: string }) => x.stufe)[0]).toBe('ingestion');
    expect((await status(req('GET', null), idCtx(1))).status).toBe(401);
    expect((await status(req('GET', 'lesen'), idCtx(999))).status).toBe(404);
    expect((await status(req('GET', 'lesen'), idCtx('abc'))).status).toBe(404);
    const e = await ergebnisse(req('GET', 'lesen', undefined, 'https://video.example.de/api/x?mindestScore=10&nurVerifiziert=1'), idCtx(1));
    expect(await e.json()).toMatchObject({ zeilen: [], total: 0 });
    const c = await csv(req('GET', 'lesen'), idCtx(1));
    expect(c.headers.get('content-type')).toMatch(/text\/csv/);
    expect(c.headers.get('content-disposition')).toMatch(/leads-lauf-1\.csv/);
    // UTF-8-BOM für Excel (text() verwirft ihn beim Dekodieren, deshalb die Bytes prüfen)
    expect([...new Uint8Array(await c.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe('Übernahme, Löschen, Wiederholen, Prüfung', () => {
  it('Übernahme: Eingaben werden geprüft, nur ab „mitglied“, unbekannte Kampagne → 400', async () => {
    const { POST } = await import('../../app/api/leadgen/runs/[id]/uebernehmen/route');
    expect((await POST(req('POST', 'lesen', { campaignId: 1, companyIds: [1] }), idCtx(1))).status).toBe(403);
    expect((await POST(req('POST', 'mitglied', { campaignId: 1, companyIds: [] }), idCtx(1))).status).toBe(400);
    const r = await POST(req('POST', 'mitglied', { campaignId: 999, companyIds: [1] }), idCtx(1));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Kampagne/);
  });

  it('Person löschen: nur ab „mitglied“, unbekannte Person → 404', async () => {
    const { DELETE } = await import('../../app/api/leadgen/personen/[id]/route');
    expect((await DELETE(req('DELETE', 'lesen'), idCtx(1))).status).toBe(403);
    expect((await DELETE(req('DELETE', 'mitglied'), idCtx(424242))).status).toBe(404);
  });

  it('fehlgeschlagenen Job wiederholen: unbekannt → 404', async () => {
    const { POST } = await import('../../app/api/leadgen/jobs/[id]/erneut/route');
    expect((await POST(req('POST', 'lesen'), idCtx(1))).status).toBe(403);
    expect((await POST(req('POST', 'mitglied'), idCtx(424242))).status).toBe(404);
  });

  it('Prüffälle: lesen, entscheiden nur ab „mitglied“, unbekannter Fall → 400', async () => {
    const { GET, POST } = await import('../../app/api/leadgen/pruefung/route');
    expect(await (await GET(req('GET', 'lesen'))).json()).toEqual([]);
    expect((await POST(req('POST', 'lesen', { id: 1, aktion: 'trennen' }))).status).toBe(403);
    expect((await POST(req('POST', 'mitglied', { id: 1, aktion: 'trennen' }))).status).toBe(400);
    expect((await POST(req('POST', 'mitglied', { id: 1, aktion: 'weissnicht' }))).status).toBe(400);
  });
});

describe('Einstellungen', () => {
  it('Brave-Schlüssel nur für Admins, wird verschlüsselt gespeichert und nie zurückgegeben', async () => {
    const { GET, PUT } = await import('../../app/api/leadgen/einstellungen/route');
    expect((await PUT(req('PUT', 'mitglied', { braveSchluessel: 'geheim-abc' }))).status).toBe(403);
    const vorher = await (await GET(req('GET', 'lesen'))).json();
    expect(vorher.braveGesetzt).toBe(false);
    expect((await PUT(req('PUT', 'admin', { braveSchluessel: 'mit leerzeichen' }))).status).toBe(400);
    const ok = await PUT(req('PUT', 'admin', { braveSchluessel: 'geheim-abc', extraktionModell: 'klein-modell' }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).not.toContain('geheim-abc');
    const nachher = await GET(req('GET', 'lesen'));
    const text = await nachher.text();
    expect(text).not.toContain('geheim-abc');
    expect(JSON.parse(text)).toMatchObject({ braveGesetzt: true, extraktionModell: 'klein-modell' });
    const { getSetting } = await import('@/lib/settings');
    expect(getSetting('brave_api_key')).not.toContain('geheim-abc');
    const { braveSchluessel } = await import('./search/brave');
    expect(braveSchluessel()).toBe('geheim-abc');
    // Leerer Wert entfernt die App-Einstellung wieder
    await PUT(req('PUT', 'admin', { braveSchluessel: '' }));
    expect(braveSchluessel()).toBeUndefined();
  });
});
