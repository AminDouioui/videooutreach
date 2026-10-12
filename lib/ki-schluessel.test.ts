import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// KI-Schlüssel in den Einstellungen: Vorrang vor .env, Verschlüsselung, Maskierung, Verfügbarkeit, Verbindungstest, Rollen.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-kischl-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});
const ENV_KEYS = ['TYPESAFE_API_KEY', 'TYPESAFE_BASE_URL', 'TYPESAFE_JEV_MODELL', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'JEV_MODELL', 'OPENAI_BASE_URL', 'JEV_BASE_URL', 'ANTHROPIC_BASE_URL'];
const GEHEIM = 'sk-test-GEHEIM-0123456789abcd';

type Mods = {
  settings: typeof import('./settings');
  view: typeof import('./settings-view');
  ki: typeof import('./ki');
  env: typeof import('./env');
  verb: typeof import('./ki-verbindung');
  route: typeof import('../app/api/settings/ki-schluessel/route');
  testRoute: typeof import('../app/api/settings/ki-schluessel/test/route');
  settingsRoute: typeof import('../app/api/settings/route');
  auth: typeof import('./auth');
  db: typeof import('./db');
};
let m: Mods;
const cookies: Record<'admin' | 'mitglied' | 'lesen', string> = { admin: '', mitglied: '', lesen: '' };

function umgebung(werte: Record<string, string | undefined> = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(werte)) if (v) process.env[k] = v;
  m.env.resetEnvCache();
}
const req = (method: string, rolle: keyof typeof cookies, body?: unknown) =>
  new Request('https://video.example.de/api/x', { method, headers: { 'content-type': 'application/json', cookie: cookies[rolle] }, body: body === undefined ? undefined : JSON.stringify(body) });
/** Alle Zeilen der Tabelle settings, roh aus der SQLite-Datei */
function rohSettings(): string {
  const db = new Database(path.join(dir, 'app.db'), { readonly: true });
  try {
    return JSON.stringify(db.prepare('select * from settings').all());
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  m = {
    settings: await import('./settings'),
    view: await import('./settings-view'),
    ki: await import('./ki'),
    env: await import('./env'),
    verb: await import('./ki-verbindung'),
    route: await import('../app/api/settings/ki-schluessel/route'),
    testRoute: await import('../app/api/settings/ki-schluessel/test/route'),
    settingsRoute: await import('../app/api/settings/route'),
    auth: await import('./auth'),
    db: await import('./db'),
  };
  const ph = '0'.repeat(32) + ':' + '0'.repeat(128);
  for (const rolle of ['admin', 'mitglied', 'lesen'] as const) {
    const b = m.db.getDb().insert(m.db.schema.benutzer).values({ email: `${rolle}@x.de`, name: rolle, passwortHash: ph, rolle }).returning().get();
    cookies[rolle] = `vo_session=${await m.auth.createSessionToken('r'.repeat(32), Date.now(), { benutzerId: b.id, rolle, version: b.sessionVersion })}`;
  }
});
beforeEach(() => umgebung());
afterEach(() => {
  for (const a of m.settings.KI_ANBIETER) m.settings.loescheKiSchluessel(a);
  for (const k of ['openai_model', 'jev_modell', 'ki_klassifizierer', 'ki_entwurf_anbieter'] as const) m.settings.deleteSetting(k);
  vi.unstubAllGlobals();
  umgebung();
});

describe('Vorrang und Entfernen', () => {
  it('ohne Schlüssel: nichts verfügbar', () => {
    expect(m.settings.kiSchluessel('openai')).toBeUndefined();
    expect([m.ki.schreibhilfeVerfuegbar(), m.ki.klassifizierungVerfuegbar()]).toEqual([false, false]);
  });
  it('.env-Wert gilt, wenn nichts gespeichert ist; Einstellung in der App hat Vorrang; Entfernen fällt auf .env zurück', () => {
    umgebung({ OPENAI_API_KEY: 'env-key-openai-1234' });
    expect(m.settings.kiSchluesselMitQuelle('openai')).toEqual({ schluessel: 'env-key-openai-1234', quelle: 'env' });
    m.settings.setzeKiSchluessel('openai', GEHEIM);
    expect(m.settings.kiSchluesselMitQuelle('openai')).toEqual({ schluessel: GEHEIM, quelle: 'app' });
    m.settings.loescheKiSchluessel('openai');
    expect(m.settings.kiSchluesselMitQuelle('openai')).toEqual({ schluessel: 'env-key-openai-1234', quelle: 'env' });
  });
  it('Modelle: Einstellung vor .env vor Standard', () => {
    expect([m.settings.kiModell('openai'), m.settings.kiModell('jev')]).toEqual(['gpt-5.5', 'typesafe/jev-1.13']);
    umgebung({ OPENAI_MODEL: 'env-modell' });
    expect(m.settings.kiModell('openai')).toBe('env-modell');
    m.settings.setSetting('openai_model', 'app-modell');
    m.settings.setSetting('jev_modell', '~typesafe/jev-latest');
    expect([m.settings.kiModell('openai'), m.settings.kiModell('jev')]).toEqual(['app-modell', '~typesafe/jev-latest']);
  });
  it('nicht entschlüsselbarer Wert (anderer ENCRYPTION_KEY) zählt als nicht gesetzt, es gilt die .env', () => {
    m.settings.setSetting('openai_api_key', 'kein-gueltiger-chiffretext');
    expect(m.settings.kiSchluessel('openai')).toBeUndefined();
    umgebung({ OPENAI_API_KEY: 'env-key-openai-1234' });
    expect(m.settings.kiSchluesselMitQuelle('openai')?.quelle).toBe('env');
  });
});

describe('Verschlüsselung', () => {
  it('die DB enthält keinen Klartext, nur Chiffretext', () => {
    m.settings.setzeKiSchluessel('anthropic', GEHEIM);
    m.settings.setzeKiSchluessel('openrouter', `${GEHEIM}-or`);
    const roh = rohSettings();
    expect(roh).toContain('anthropic_api_key');
    expect(roh).not.toContain('GEHEIM');
    expect(roh).not.toContain('0123456789abcd');
    expect(m.settings.getSetting('anthropic_api_key')).not.toBe(GEHEIM);
    expect(m.settings.kiSchluessel('anthropic')).toBe(GEHEIM);
  });
  it('Eingabeprüfung: trimmt, verbietet Leerraum im Wert, leer und > 300 Zeichen', () => {
    expect(m.settings.pruefeKiSchluessel('  abc123  ')).toEqual({ ok: true, wert: 'abc123' });
    for (const schlecht of ['', '   ', 'a b', 'a\nb', 'x'.repeat(301)]) expect(m.settings.pruefeKiSchluessel(schlecht).ok).toBe(false);
    expect(m.settings.pruefeKiSchluessel('x'.repeat(300)).ok).toBe(true);
  });
  it('Maske zeigt nur die letzten 4 Zeichen', () => {
    expect(m.settings.maskiereSchluessel(GEHEIM)).toBe('…abcd');
    expect(m.settings.maskiereSchluessel('kurz')).toBe('…');
  });
});

describe('Verfügbarkeit und Anbieterwahl reagieren sofort', () => {
  it('Schlüssel speichern schaltet Funktionen und Auswahl frei, Entfernen nimmt sie zurück', () => {
    m.settings.setzeKiSchluessel('openrouter', GEHEIM);
    expect([m.ki.klassifizierungVerfuegbar(), m.ki.schreibhilfeVerfuegbar()]).toEqual([true, false]);
    expect(m.settings.kiKlassifizierer()).toBe('jev');
    m.settings.setzeKiSchluessel('openai', GEHEIM);
    expect(m.ki.schreibhilfeVerfuegbar()).toBe(true);
    expect(m.settings.verfuegbareEntwurfAnbieter()).toEqual(['openai']);
    m.settings.setzeKiSchluessel('anthropic', GEHEIM);
    expect(m.settings.verfuegbareKlassifizierer()).toEqual(['anthropic', 'jev']);
    expect(m.settings.verfuegbareEntwurfAnbieter()).toEqual(['openai', 'anthropic']);
    m.settings.setSetting('ki_klassifizierer', 'anthropic');
    expect(m.settings.kiKlassifizierer()).toBe('anthropic');
    m.settings.loescheKiSchluessel('anthropic');
    expect(m.settings.kiKlassifizierer()).toBe('jev'); // gewählter Anbieter hat keinen Schlüssel mehr
    expect(m.settings.verfuegbareEntwurfAnbieter()).toEqual(['openai']);
    m.settings.loescheKiSchluessel('openrouter');
    m.settings.loescheKiSchluessel('openai');
    expect([m.ki.klassifizierungVerfuegbar(), m.ki.schreibhilfeVerfuegbar(), m.settings.kiKlassifizierer(), m.settings.kiEntwurfAnbieter()]).toEqual([false, false, null, null]);
  });
  it('OpenAI und Jev nutzen den App-Schlüssel und das App-Modell in der Anfrage', async () => {
    const { openaiClient } = await import('./ki-openai');
    const { ordneAntwortMitJev } = await import('./ki-jev');
    m.settings.setzeKiSchluessel('openai', 'oai-APP-1234567890');
    m.settings.setzeKiSchluessel('openrouter', 'or-APP-1234567890');
    m.settings.setSetting('openai_model', 'mein-oai');
    m.settings.setSetting('jev_modell', 'mein-jev');
    const aufrufe: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      aufrufe.push({ url, init });
      return new Response(JSON.stringify(url.includes('decisions') ? { answers: { kategorie: { choice: 'interessiert', confidence: 0.9, probabilities: { interessiert: 0.9 } } } } : { output_text: '{"text":"x"}' }), { status: 200 });
    }) as unknown as typeof fetch;
    await openaiClient(f)({ modell: 'm', system: 's', nutzer: 'n', schema: {}, maxTokens: 10, effort: 'low' });
    await ordneAntwortMitJev('Ja gern', 'Re', f);
    expect((aufrufe[0].init.headers as Record<string, string>).Authorization).toBe('Bearer oai-APP-1234567890');
    expect(String(aufrufe[0].init.body)).toContain('"model":"mein-oai"');
    expect((aufrufe[1].init.headers as Record<string, string>).Authorization).toBe('Bearer or-APP-1234567890');
    expect(String(aufrufe[1].init.body)).toContain('mein-jev');
  });
});

describe('Einstellungs-Ansicht und API', () => {
  it('Ansicht: Admin sieht nur die Maske, andere nur ja/nein; nie der Schlüssel', () => {
    m.settings.setzeKiSchluessel('openai', GEHEIM);
    umgebung({ OPENROUTER_API_KEY: 'env-or-key-wxyz9876' });
    const admin = m.view.ladeEinstellungen(true);
    expect(admin.kiSchluessel.openai).toEqual({ gesetzt: true, quelle: 'app', maske: '…abcd', appGespeichert: true });
    expect(admin.kiSchluessel.openrouter).toEqual({ gesetzt: true, quelle: 'env', maske: '…9876', appGespeichert: false });
    expect(admin.kiSchluessel.anthropic).toEqual({ gesetzt: false, quelle: null, maske: null, appGespeichert: false });
    const andere = m.view.ladeEinstellungen();
    expect(andere.kiSchluessel.openai.maske).toBeNull();
    for (const a of [admin, andere]) {
      const text = JSON.stringify(a);
      expect(text).not.toContain('GEHEIM');
      expect(text).not.toContain('env-or-key');
    }
  });
  it('API: Admin speichert/entfernt, Antworten enthalten keinen Schlüssel', async () => {
    const put = await m.route.PUT(req('PUT', 'admin', { anbieter: 'openai', schluessel: `  ${GEHEIM}  ` }));
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain('GEHEIM');
    expect(JSON.parse(putText).kiSchluessel.openai).toMatchObject({ gesetzt: true, maske: '…abcd', quelle: 'app' });
    expect(m.settings.kiSchluessel('openai')).toBe(GEHEIM);
    for (const rolle of ['admin', 'mitglied', 'lesen'] as const) {
      const get = await m.settingsRoute.GET(req('GET', rolle));
      const text = await get.text();
      expect(text).not.toContain('GEHEIM');
      const j = JSON.parse(text);
      expect(j.kiSchluessel.openai.gesetzt).toBe(true);
      expect(j.kiSchluessel.openai.maske).toBe(rolle === 'admin' ? '…abcd' : null);
    }
    const del = await m.route.DELETE(req('DELETE', 'admin', { anbieter: 'openai' }));
    expect(JSON.parse(await del.text()).kiSchluessel.openai.gesetzt).toBe(false);
  });
  it('API: ungültige Eingaben → 400, nichts gespeichert', async () => {
    for (const body of [{ anbieter: 'openai', schluessel: '' }, { anbieter: 'openai', schluessel: 'a b' }, { anbieter: 'openai', schluessel: 'x'.repeat(301) }, { anbieter: 'gibtsnicht', schluessel: 'abc' }]) {
      expect((await m.route.PUT(req('PUT', 'admin', body))).status).toBe(400);
    }
    expect(m.settings.kiSchluessel('openai')).toBeUndefined();
  });
  it('API: mitglied und lesen bekommen 403 und nichts wird geändert', async () => {
    for (const rolle of ['mitglied', 'lesen'] as const) {
      expect((await m.route.PUT(req('PUT', rolle, { anbieter: 'openai', schluessel: GEHEIM }))).status).toBe(403);
      expect((await m.route.DELETE(req('DELETE', rolle, { anbieter: 'openai' }))).status).toBe(403);
      expect((await m.testRoute.POST(req('POST', rolle, { anbieter: 'openai' }))).status).toBe(403);
    }
    expect(m.settings.kiSchluessel('openai')).toBeUndefined();
  });
  it('Hauptformular: Modelle speichern und leeren; Auswahl nur mit Schlüssel', async () => {
    const basis = { senderName: '', signature: '', globalDailyLimit: 30, rampeAktiv: false, rampeStart: 10, rampeSchritt: 5, rampeBeginn: '', bounceSchwellePostfach: 5, impressumUrl: '', datenschutzUrl: '' };
    const res = await m.settingsRoute.PUT(req('PUT', 'admin', { ...basis, openaiModell: ' gpt-x ', jevModell: '~typesafe/jev-latest' }));
    expect(res.status).toBe(200);
    expect([m.settings.kiModell('openai'), m.settings.kiModell('jev')]).toEqual(['gpt-x', '~typesafe/jev-latest']);
    await m.settingsRoute.PUT(req('PUT', 'admin', { ...basis, openaiModell: '' }));
    expect(m.settings.kiModell('openai')).toBe('gpt-5.5');
    expect(m.settings.kiModell('jev')).toBe('~typesafe/jev-latest'); // Feld fehlte → unverändert
    expect((await m.settingsRoute.PUT(req('PUT', 'admin', { ...basis, kiEntwurfAnbieter: 'openai' }))).status).toBe(400);
    m.settings.setzeKiSchluessel('openai', GEHEIM);
    expect((await m.settingsRoute.PUT(req('PUT', 'admin', { ...basis, kiEntwurfAnbieter: 'openai' }))).status).toBe(200);
  });
});

describe('Verbindungstest (injiziertes fetch)', () => {
  const antwort = (status: number) => (async () => new Response('{"geheim":"nicht ausgeben"}', { status })) as unknown as typeof fetch;
  it('200 → gültig; 401/403 → ungültig mit Status; Netzfehler → Keine Verbindung; Zeitüberschreitung', async () => {
    expect(await m.verb.testeKiVerbindung('openai', 'k1', antwort(200))).toMatchObject({ ok: true, meldung: 'Schlüssel gültig' });
    expect(await m.verb.testeKiVerbindung('openai', 'k1', antwort(401))).toMatchObject({ ok: false, meldung: 'Schlüssel ungültig (401)' });
    expect(await m.verb.testeKiVerbindung('openrouter', 'k1', antwort(403))).toMatchObject({ ok: false, meldung: 'Schlüssel ungültig (403)' });
    expect(await m.verb.testeKiVerbindung('anthropic', 'k1', antwort(500))).toMatchObject({ ok: false });
    const netz = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await m.verb.testeKiVerbindung('openai', 'k1', netz)).toEqual({ ok: false, meldung: 'Keine Verbindung' });
    const zeit = (async () => {
      throw new DOMException('timeout', 'TimeoutError');
    }) as unknown as typeof fetch;
    expect((await m.verb.testeKiVerbindung('openai', 'k1', zeit)).meldung).toContain('Keine Verbindung');
  });
  it('Endpunkte und Header je Anbieter; ohne Schlüssel keine Anfrage', async () => {
    const aufrufe: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      aufrufe.push({ url, headers: init.headers as Record<string, string> });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    umgebung({ OPENAI_BASE_URL: 'http://127.0.0.1:1/v1/', JEV_BASE_URL: 'http://127.0.0.1:2/api' });
    await m.verb.testeKiVerbindung('openai', 'kk', f);
    await m.verb.testeKiVerbindung('openrouter', 'kk', f);
    await m.verb.testeKiVerbindung('anthropic', 'kk', f);
    expect(aufrufe[0]).toEqual({ url: 'http://127.0.0.1:1/v1/models', headers: { Authorization: 'Bearer kk' } });
    expect(aufrufe[1]).toEqual({ url: 'http://127.0.0.1:2/api/v1/key', headers: { Authorization: 'Bearer kk' } });
    expect(aufrufe[2].url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(aufrufe[2].headers['x-api-key']).toBe('kk');
    expect(await m.verb.testeKiVerbindung('openai', undefined, f)).toMatchObject({ ok: false, meldung: 'Kein Schlüssel hinterlegt.' });
    expect(aufrufe).toHaveLength(3);
  });
  it('Test-Route: nutzt eingegebenen oder gespeicherten Schlüssel und gibt ihn nie zurück', async () => {
    const gesehen: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      gesehen.push((init.headers as Record<string, string>).Authorization);
      return new Response('{}', { status: 401 });
    });
    const a = await m.testRoute.POST(req('POST', 'admin', { anbieter: 'openai', schluessel: GEHEIM }));
    const text = await a.text();
    expect(JSON.parse(text)).toEqual({ ok: false, meldung: 'Schlüssel ungültig (401)' });
    expect(text).not.toContain('GEHEIM');
    m.settings.setzeKiSchluessel('openai', 'gespeichert-123456');
    await m.testRoute.POST(req('POST', 'admin', { anbieter: 'openai' }));
    expect(gesehen).toEqual([`Bearer ${GEHEIM}`, 'Bearer gespeichert-123456']);
    const leer = await m.testRoute.POST(req('POST', 'admin', { anbieter: 'anthropic' }));
    expect((await leer.json()).meldung).toBe('Kein Schlüssel hinterlegt.');
  });
});

describe('TypeSafe (Jev direkt)', () => {
  it('Schlüssel verschlüsselt speichern, schaltet Jev frei, .env-Fallback und Vorrang der App', () => {
    expect(m.settings.verfuegbareKlassifizierer()).toEqual([]);
    umgebung({ TYPESAFE_API_KEY: 'env-typesafe-1234' });
    expect(m.settings.kiSchluesselMitQuelle('typesafe')?.quelle).toBe('env');
    expect(m.settings.verfuegbareKlassifizierer()).toEqual(['jev']);
    expect(m.ki.klassifizierungVerfuegbar()).toBe(true);
    m.settings.setzeKiSchluessel('typesafe', GEHEIM);
    expect(m.settings.kiSchluesselMitQuelle('typesafe')).toEqual({ schluessel: GEHEIM, quelle: 'app' });
    expect(rohSettings()).toContain('typesafe_api_key');
    expect(rohSettings()).not.toContain('0123456789abcd');
    expect(m.settings.jevAnbieter()).toBe('typesafe');
    m.settings.setzeKiSchluessel('openrouter', 'sk-or-x-123456789');
    expect(m.settings.jevAnbieter()).toBe('typesafe');
    m.settings.loescheKiSchluessel('typesafe');
    umgebung({});
    expect(m.settings.jevAnbieter()).toBe('openrouter');
    m.settings.loescheKiSchluessel('openrouter');
    expect(m.settings.jevAnbieter()).toBeNull();
  });
  it('Modell: Standard jev-latest, TYPESAFE_JEV_MODELL, Einstellung gewinnt; Status je Anbieter', async () => {
    expect(m.settings.kiModell('typesafe')).toBe('jev-latest');
    umgebung({ TYPESAFE_JEV_MODELL: 'jev-1.13' });
    expect(m.settings.kiModell('typesafe')).toBe('jev-1.13');
    m.settings.setSetting('typesafe_modell', 'jev-x');
    expect(m.settings.kiModell('typesafe')).toBe('jev-x');
    m.settings.deleteSetting('typesafe_modell');
    expect(m.view.kiSchluesselStatus(true).typesafe).toEqual({ gesetzt: false, quelle: null, maske: null, appGespeichert: false });
  });
  it('Routen: Admin setzt den Schlüssel, Mitglied nicht', async () => {
    expect((await m.route.PUT(req('PUT', 'mitglied', { anbieter: 'typesafe', schluessel: GEHEIM }))).status).toBe(403);
    const res = await m.route.PUT(req('PUT', 'admin', { anbieter: 'typesafe', schluessel: GEHEIM }));
    expect(res.status).toBe(200);
    expect((await res.json()).kiSchluessel.typesafe).toEqual({ gesetzt: true, quelle: 'app', maske: '…abcd', appGespeichert: true });
    m.settings.loescheKiSchluessel('typesafe');
  });
  it('Verbindungstest: GET {TYPESAFE_BASE_URL}/v1/models mit Bearer; zeigt Modelle und warnt bei unbekanntem Modell', async () => {
    const aufrufe: { url: string; method?: string; headers: Record<string, string> }[] = [];
    const mitListe = (liste: unknown) =>
      (async (url: string, init: RequestInit) => {
        aufrufe.push({ url, method: init.method, headers: init.headers as Record<string, string> });
        return new Response(JSON.stringify(liste), { status: 200 });
      }) as unknown as typeof fetch;
    umgebung({ TYPESAFE_BASE_URL: 'http://127.0.0.1:5/' });
    const a = await m.verb.testeKiVerbindung('typesafe', 'kk', mitListe({ data: [{ id: 'jev-1.13.0' }, { id: 'jev-2' }] }));
    expect(aufrufe[0]).toEqual({ url: 'http://127.0.0.1:5/v1/models', method: 'GET', headers: { Authorization: 'Bearer kk' } });
    expect(a).toMatchObject({ ok: true, modelle: ['jev-1.13.0', 'jev-2'] });
    expect(a.meldung).toContain('jev-1.13.0, jev-2');
    expect(a.meldung).not.toContain('Achtung'); // Standard jev-latest: es gibt Jev-Modelle
    umgebung({ TYPESAFE_JEV_MODELL: 'foo-3' });
    const b = await m.verb.testeKiVerbindung('typesafe', 'kk', mitListe(['jev-latest', 'jev-1.13']));
    expect(b.meldung).toContain('Achtung');
    expect(b.meldung).toContain('foo-3');
    umgebung({ TYPESAFE_JEV_MODELL: 'jev-1.13' });
    expect((await m.verb.testeKiVerbindung('typesafe', 'kk', mitListe({ models: ['jev-1.13.0'] }))).meldung).not.toContain('Achtung');
    const unbekannt = await m.verb.testeKiVerbindung('typesafe', 'kk', mitListe({ foo: 1 }));
    expect(unbekannt).toMatchObject({ ok: true, meldung: 'Schlüssel gültig' });
    const f401 = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    expect(await m.verb.testeKiVerbindung('typesafe', 'kk', f401)).toMatchObject({ ok: false, meldung: 'Schlüssel ungültig (401)' });
    umgebung({});
    await m.verb.testeKiVerbindung('typesafe', 'kk', mitListe([]));
    expect(aufrufe.at(-1)?.url).toBe('https://api.typesafe.ai/v1/models');
  });
  it('Test-Route ohne Netz: Meldung „Keine Verbindung“, kein OpenRouter-Bezug', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const res = await m.testRoute.POST(req('POST', 'admin', { anbieter: 'typesafe', schluessel: GEHEIM }));
    expect(await res.json()).toEqual({ ok: false, meldung: 'Keine Verbindung' });
  });
});
