import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from './env';
import { KiFehler } from './ki';
import { jevAnfrage, JEV_KRITERIEN, leseJevAntwort, ordneAntwortMitJev } from './ki-jev';
import { KI_KATEGORIEN } from './ki-kategorien';

Object.assign(process.env, {
  DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'vo-jev-')),
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
});

function umgebung(werte: Record<string, string | undefined>) {
  for (const k of ['OPENROUTER_API_KEY', 'JEV_MODELL', 'JEV_BASE_URL', 'TYPESAFE_API_KEY', 'TYPESAFE_BASE_URL', 'TYPESAFE_JEV_MODELL']) delete process.env[k];
  for (const [k, v] of Object.entries(werte)) if (v) process.env[k] = v;
  resetEnvCache();
}
afterEach(() => umgebung({}));

type Aufruf = { url: string; init: RequestInit };
function fetchMit(antwort: Response | Error) {
  const aufrufe: Aufruf[] = [];
  const f = (async (url: string, init: RequestInit) => {
    aufrufe.push({ url, init });
    if (antwort instanceof Error) throw antwort;
    return antwort.clone();
  }) as unknown as typeof fetch;
  return { aufrufe, f };
}
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
const gut = { answers: { kategorie: { choice: 'interessiert', confidence: 0.92, probabilities: { interessiert: 0.92, spaeter: 0.05, sonstiges: 0.02, abmeldung: 0.01 } } } };

describe('Request', () => {
  it('URL, Header und Body-Form; Standardmodell und Standard-Basis-URL', async () => {
    umgebung({ OPENROUTER_API_KEY: 'or-geheim' });
    const { aufrufe, f } = fetchMit(json(gut));
    await ordneAntwortMitJev('Gern, rufen Sie an.', 'Re: Video', f);
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0].url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(aufrufe[0].init.method).toBe('POST');
    expect(aufrufe[0].init.headers).toEqual({ Authorization: 'Bearer or-geheim', 'Content-Type': 'application/json' });
    const body = JSON.parse(String(aufrufe[0].init.body));
    expect(body.model).toBe('typesafe/jev-1.13');
    expect(body.state).toEqual({ betreff: 'Re: Video', text: 'Gern, rufen Sie an.', sprache: 'de' });
    expect(Object.keys(body.questions)).toEqual(['kategorie']);
    const frage = body.questions.kategorie;
    expect(frage.type).toBe('choice');
    expect(typeof frage.instructions).toBe('string');
    expect(Object.keys(frage.criteria)).toEqual([...KI_KATEGORIEN]);
    expect(frage.criteria.abwesenheit).toMatch(/Abwesenheits/);
  });
  it('JEV_MODELL und JEV_BASE_URL überschreibbar (auch mit Schrägstrich am Ende)', async () => {
    umgebung({ OPENROUTER_API_KEY: 'k', JEV_MODELL: '~typesafe/jev-latest', JEV_BASE_URL: 'http://127.0.0.1:3199/api/' });
    const { aufrufe, f } = fetchMit(json(gut));
    await ordneAntwortMitJev('Text', '', f);
    expect(aufrufe[0].url).toBe('http://127.0.0.1:3199/api/alpha/decisions');
    expect(JSON.parse(String(aufrufe[0].init.body)).model).toBe('~typesafe/jev-latest');
  });
  it('Text wird bereinigt und auf ~4000 Zeichen gekürzt; ohne Schlüssel oder ohne Text keine Anfrage', async () => {
    umgebung({ OPENROUTER_API_KEY: 'k' });
    const { aufrufe, f } = fetchMit(json(gut));
    await ordneAntwortMitJev(`Hallo   Welt\n\n\n\n${'x'.repeat(6000)}`, '', f);
    const text = JSON.parse(String(aufrufe[0].init.body)).state.text as string;
    expect(text.startsWith('Hallo Welt\n\nxxx')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(4002);
    await expect(ordneAntwortMitJev('   ', '', f)).rejects.toMatchObject({ art: 'antwort' });
    expect(aufrufe).toHaveLength(1);
    umgebung({});
    await expect(ordneAntwortMitJev('Text', '', f)).rejects.toMatchObject({ art: 'deaktiviert' });
    expect(aufrufe).toHaveLength(1);
  });
  it('jevAnfrage: Kriterien sind für alle Kategorien beschrieben', () => {
    expect(Object.keys(JEV_KRITERIEN).sort()).toEqual([...KI_KATEGORIEN].sort());
    expect(jevAnfrage('b', 't', 'm').questions.kategorie.criteria).toBe(JEV_KRITERIEN);
  });
});

describe('Antwort lesen', () => {
  const p = { interessiert: 0.7, spaeter: 0.3 };
  it.each([
    ['answers', { answers: { kategorie: { choice: 'spaeter', confidence: 0.8, probabilities: p } } }],
    ['results', { results: { kategorie: { choice: 'spaeter', confidence: 0.8, probabilities: p } } }],
    ['decisions', { decisions: { kategorie: { choice: 'spaeter', confidence: 0.8, probabilities: p } } }],
    ['direkt', { id: 'gen-1', provider: 'TypeSafe', usage: { cost: 0.001 }, kategorie: { choice: 'spaeter', confidence: 0.8, probabilities: p } }],
    ['answer-Feld', { answers: { kategorie: { answer: 'spaeter', confidence: 0.8 } } }],
    ['option-Feld', { answers: { kategorie: { option: 'spaeter', confidence: 0.8 } } }],
    ['JSON im Chat-Inhalt', { choices: [{ message: { content: JSON.stringify({ kategorie: { choice: 'spaeter', confidence: 0.8 } }) } }] }],
  ])('Form: %s', (_n, antwort) => {
    expect(leseJevAntwort(antwort)).toMatchObject({ kategorie: 'spaeter', konfidenz: 0.8 });
  });
  it('fehlende confidence → größte Wahrscheinlichkeit; Prozentwerte werden umgerechnet; Groß-/Schreibweise toleriert', () => {
    expect(leseJevAntwort({ kategorie: { choice: 'Nicht_Interessiert', probabilities: { nicht_interessiert: 0.64, spaeter: 0.3 } } })).toMatchObject({ kategorie: 'nicht_interessiert', konfidenz: 0.64 });
    expect(leseJevAntwort({ kategorie: { choice: 'interessiert', confidence: 92 } })).toMatchObject({ konfidenz: 0.92 });
  });
  it('Antwort ohne Wahrscheinlichkeiten und ohne confidence: Konfidenz 0 (nie automatisch anwenden)', () => {
    expect(leseJevAntwort({ kategorie: 'interessiert' })).toMatchObject({ kategorie: 'interessiert', konfidenz: 0 });
  });
  it('unbekanntes Format → null; unbekannte Kategorie → KiFehler', () => {
    expect(leseJevAntwort({ foo: 'bar' })).toBeNull();
    expect(leseJevAntwort(null)).toBeNull();
    expect(leseJevAntwort('x')).toBeNull();
    expect(() => leseJevAntwort({ kategorie: { choice: 'vielleicht' } })).toThrow(KiFehler);
  });
  it('Begründung aus den Top-Wahrscheinlichkeiten', async () => {
    umgebung({ OPENROUTER_API_KEY: 'k' });
    const e = await ordneAntwortMitJev('Text', '', fetchMit(json(gut)).f);
    expect(e).toEqual({ kategorie: 'interessiert', konfidenz: 0.92, begruendung: 'Jev: 92 % interessiert, 5 % später, 2 % sonstiges' });
  });
});

describe('Fehler', () => {
  it.each([
    [401, 'schluessel', 'OPENROUTER_API_KEY'],
    [403, 'schluessel', 'OPENROUTER_API_KEY'],
    [402, 'guthaben', 'Guthaben'],
    [404, 'anfrage', 'JEV_MODELL'],
    [429, 'limit', 'Rate-Limit'],
    [500, 'ueberlast', '500'],
    [503, 'ueberlast', '503'],
    [400, 'anfrage', '400'],
  ])('HTTP %i → %s', async (status, art, text) => {
    umgebung({ OPENROUTER_API_KEY: 'k' });
    const err = await ordneAntwortMitJev('Text', '', fetchMit(new Response('{"error":"Mailinhalt?"}', { status })).f).catch((e) => e);
    expect(err).toBeInstanceOf(KiFehler);
    expect(err.art).toBe(art);
    expect(err.message).toContain(text);
    expect(err.message).not.toContain('Mailinhalt');
  });
  it('429/5xx sind wiederholbar, 401/402 nicht', async () => {
    umgebung({ OPENROUTER_API_KEY: 'k' });
    const w = async (s: number) => (await ordneAntwortMitJev('Text', '', fetchMit(new Response('', { status: s })).f).catch((e) => e)).wiederholbar;
    expect([await w(429), await w(502), await w(401), await w(402)]).toEqual([true, true, false, false]);
  });
  it('Netzfehler, Zeitüberschreitung, kaputtes JSON, unbekanntes Format (mit HTTP-Status)', async () => {
    umgebung({ OPENROUTER_API_KEY: 'k' });
    const zeit = Object.assign(new Error('t'), { name: 'TimeoutError' });
    expect(await ordneAntwortMitJev('T', '', fetchMit(new TypeError('fetch failed')).f).catch((e) => e)).toMatchObject({ art: 'verbindung' });
    expect(await ordneAntwortMitJev('T', '', fetchMit(zeit).f).catch((e) => e)).toMatchObject({ art: 'zeit' });
    const kaputt = await ordneAntwortMitJev('T', '', fetchMit(new Response('<html>', { status: 200 })).f).catch((e) => e);
    expect(kaputt).toMatchObject({ art: 'antwort' });
    expect(kaputt.message).toContain('200');
    const fremd = await ordneAntwortMitJev('T', '', fetchMit(json({ ok: true })).f).catch((e) => e);
    expect(fremd).toMatchObject({ art: 'antwort' });
    expect(fremd.message).toContain('unbekanntes Format');
    expect(fremd.message).toContain('200');
  });
});

describe('TypeSafe direkt', () => {
  // Antwortform laut TypeSafe-Dokumentation (/v1/systemone)
  const doku = {
    model: 'jev-1.13.0',
    answers: { kategorie: { type: 'choice', choice: 'nicht_interessiert', probabilities: { nicht_interessiert: 0.85, spaeter: 0.1, sonstiges: 0.05 }, confidence: 0.82 } },
    usage: { input_tokens: 120, output_tokens: 8 },
  };
  it('URL, Header, Body und Standardmodell jev-latest; TYPESAFE_BASE_URL überschreibbar', async () => {
    umgebung({ TYPESAFE_API_KEY: 'ts-geheim' });
    const { aufrufe, f } = fetchMit(json(doku));
    await ordneAntwortMitJev('Kein Bedarf, danke.', 'Re: Video', f);
    expect(aufrufe[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(aufrufe[0].init.method).toBe('POST');
    expect(aufrufe[0].init.headers).toEqual({ Authorization: 'Bearer ts-geheim', 'Content-Type': 'application/json' });
    const body = JSON.parse(String(aufrufe[0].init.body));
    expect(body.model).toBe('jev-latest');
    expect(body.state.text).toBe('Kein Bedarf, danke.');
    expect(body.questions.kategorie.type).toBe('choice');
    expect(Object.keys(body.questions.kategorie.criteria)).toEqual([...KI_KATEGORIEN]);
    umgebung({ TYPESAFE_API_KEY: 'k', TYPESAFE_BASE_URL: 'http://127.0.0.1:3199/', TYPESAFE_JEV_MODELL: 'jev-1.13' });
    const z = fetchMit(json(doku));
    await ordneAntwortMitJev('Text', '', z.f);
    expect(z.aufrufe[0].url).toBe('http://127.0.0.1:3199/v1/systemone');
    expect(JSON.parse(String(z.aufrufe[0].init.body)).model).toBe('jev-1.13');
  });
  it('liest die dokumentierte Antwort', async () => {
    expect(leseJevAntwort(doku)).toMatchObject({ kategorie: 'nicht_interessiert', konfidenz: 0.82 });
    umgebung({ TYPESAFE_API_KEY: 'k' });
    const e = await ordneAntwortMitJev('Text', '', fetchMit(json(doku)).f);
    expect(e).toEqual({ kategorie: 'nicht_interessiert', konfidenz: 0.82, begruendung: 'Jev: 85 % nicht interessiert, 10 % später, 5 % sonstiges' });
  });
  it('TypeSafe hat Vorrang vor OpenRouter; nur OpenRouter-Schlüssel nutzt OpenRouter', async () => {
    umgebung({ TYPESAFE_API_KEY: 'ts', OPENROUTER_API_KEY: 'or' });
    const a = fetchMit(json(doku));
    await ordneAntwortMitJev('Text', '', a.f);
    expect(a.aufrufe[0].url).toContain('api.typesafe.ai');
    expect((a.aufrufe[0].init.headers as Record<string, string>).Authorization).toBe('Bearer ts');
    umgebung({ OPENROUTER_API_KEY: 'or' });
    const b = fetchMit(json(doku));
    await ordneAntwortMitJev('Text', '', b.f);
    expect(b.aufrufe[0].url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(JSON.parse(String(b.aufrufe[0].init.body)).model).toBe('typesafe/jev-1.13');
  });
  it('401 nennt das TypeSafe-Feld, 400 weist auf den Modellnamen hin, OpenRouter-Meldung bleibt beim OpenRouter-Zugang', async () => {
    umgebung({ TYPESAFE_API_KEY: 'k' });
    const e401 = await ordneAntwortMitJev('Text', '', fetchMit(new Response('', { status: 401 })).f).catch((e) => e);
    expect(e401).toMatchObject({ art: 'schluessel' });
    expect(e401.message).toContain('TypeSafe');
    expect(e401.message).toContain('TYPESAFE_API_KEY');
    expect(e401.message).not.toContain('OPENROUTER_API_KEY');
    const e400 = await ordneAntwortMitJev('Text', '', fetchMit(new Response('{"error":"Mailinhalt"}', { status: 400 })).f).catch((e) => e);
    expect(e400).toMatchObject({ art: 'anfrage' });
    expect(e400.message).toContain('Modellname');
    expect(e400.message).toContain('TYPESAFE_JEV_MODELL');
    expect(e400.message).not.toContain('Mailinhalt');
    umgebung({});
    await expect(ordneAntwortMitJev('Text', '', fetchMit(json(doku)).f)).rejects.toMatchObject({ art: 'deaktiviert' });
  });
});
