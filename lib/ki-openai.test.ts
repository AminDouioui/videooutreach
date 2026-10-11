import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from './env';
import { entwerfeAntwort, KiFehler, schlageVorlageVor, type KiAnfrage } from './ki';
import { leseOpenAiText, openaiClient } from './ki-openai';

Object.assign(process.env, {
  DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'vo-oai-')),
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
});
function umgebung(werte: Record<string, string | undefined>) {
  for (const k of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL']) delete process.env[k];
  for (const [k, v] of Object.entries(werte)) if (v) process.env[k] = v;
  resetEnvCache();
}
afterEach(() => umgebung({}));

const anfrage: KiAnfrage = { modell: 'claude-x', system: 'SYS', nutzer: 'NUTZER', schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, maxTokens: 1500, effort: 'medium' };
function fetchMit(...antworten: (Response | Error)[]) {
  const aufrufe: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    aufrufe.push({ url, init });
    const a = antworten[Math.min(aufrufe.length - 1, antworten.length - 1)];
    if (a instanceof Error) throw a;
    return a.clone();
  }) as unknown as typeof fetch;
  return { aufrufe, f };
}
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
const antwort = (text: string) => json({ id: 'resp_1', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text }] }] });

describe('Request', () => {
  it('URL, Header, Body (model, instructions, input, JSON-Schema) und Standardwerte', async () => {
    umgebung({ OPENAI_API_KEY: 'sk-oai' });
    const { aufrufe, f } = fetchMit(antwort('{"text":"Hallo"}'));
    expect(await openaiClient(f)(anfrage)).toBe('{"text":"Hallo"}');
    expect(aufrufe[0].url).toBe('https://api.openai.com/v1/responses');
    expect(aufrufe[0].init.headers).toEqual({ Authorization: 'Bearer sk-oai', 'Content-Type': 'application/json' });
    const body = JSON.parse(String(aufrufe[0].init.body));
    expect(body).toMatchObject({ model: 'gpt-5.5', instructions: 'SYS', input: 'NUTZER', text: { format: { type: 'json_schema', strict: true, schema: anfrage.schema } } });
    expect(body.max_output_tokens).toBeGreaterThanOrEqual(1500);
  });
  it('OPENAI_MODEL und OPENAI_BASE_URL überschreibbar', async () => {
    umgebung({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'mein-modell', OPENAI_BASE_URL: 'http://127.0.0.1:3199/v1/' });
    const { aufrufe, f } = fetchMit(antwort('{}'));
    await openaiClient(f)(anfrage);
    expect(aufrufe[0].url).toBe('http://127.0.0.1:3199/v1/responses');
    expect(JSON.parse(String(aufrufe[0].init.body)).model).toBe('mein-modell');
  });
  it('ohne Schlüssel keine Anfrage', async () => {
    const { aufrufe, f } = fetchMit(antwort('{}'));
    await expect(openaiClient(f)(anfrage)).rejects.toMatchObject({ art: 'deaktiviert' });
    expect(aufrufe).toHaveLength(0);
  });
});

describe('Antwort lesen', () => {
  it('output_text, output[].content[].text und Chat-Form', () => {
    expect(leseOpenAiText({ output_text: 'A' })).toBe('A');
    expect(leseOpenAiText({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'B' }, { type: 'output_text', text: 'C' }] }] })).toBe('BC');
    expect(leseOpenAiText({ choices: [{ message: { content: 'D' } }] })).toBe('D');
    expect(leseOpenAiText({ output: [{ type: 'reasoning' }] })).toBeNull();
    expect(leseOpenAiText(null)).toBeNull();
  });
  it('abgeschnitten, Ablehnung, kaputtes JSON, unbekanntes Format → verständliche Fehler', async () => {
    umgebung({ OPENAI_API_KEY: 'k' });
    const fehler = async (r: Response) => openaiClient(fetchMit(r).f)(anfrage).catch((e) => e);
    expect(await fehler(json({ status: 'incomplete', output: [] }))).toMatchObject({ art: 'antwort', wiederholbar: true });
    expect(await fehler(json({ output: [{ content: [{ type: 'refusal', refusal: 'nein' }] }] }))).toMatchObject({ art: 'antwort', wiederholbar: false });
    expect((await fehler(new Response('<html>', { status: 200 }))).message).toContain('200');
    expect((await fehler(json({ foo: 1 }))).message).toContain('unbekanntes Format');
  });
});

describe('Fehler', () => {
  it.each([
    [401, {}, 'schluessel', 'OPENAI_API_KEY'],
    [429, { error: { code: 'insufficient_quota' } }, 'guthaben', 'insufficient_quota'],
    [429, { error: { code: 'rate_limit_exceeded' } }, 'limit', 'Rate-Limit'],
    [404, { error: { code: 'model_not_found' } }, 'anfrage', 'OPENAI_MODEL'],
    [400, { error: { code: 'model_not_found' } }, 'anfrage', 'model not found'],
    [500, {}, 'ueberlast', '500'],
    [503, {}, 'ueberlast', '503'],
    [400, { error: { message: 'Mailinhalt' } }, 'anfrage', '400'],
  ])('HTTP %i %j → %s', async (status, body, art, text) => {
    umgebung({ OPENAI_API_KEY: 'k' });
    const err = await openaiClient(fetchMit(json(body, status)).f)(anfrage).catch((e) => e);
    expect(err).toBeInstanceOf(KiFehler);
    expect(err.art).toBe(art);
    expect(err.message).toContain(text);
    expect(err.message).not.toContain('Mailinhalt');
  });
  it('Netzfehler und Zeitüberschreitung', async () => {
    umgebung({ OPENAI_API_KEY: 'k' });
    expect(await openaiClient(fetchMit(new TypeError('x')).f)(anfrage).catch((e) => e)).toMatchObject({ art: 'verbindung' });
    expect(await openaiClient(fetchMit(Object.assign(new Error('t'), { name: 'TimeoutError' })).f)(anfrage).catch((e) => e)).toMatchObject({ art: 'zeit' });
  });
});

describe('Einsatz für Entwurf und Schreibhilfe', () => {
  it('entwerfeAntwort und schlageVorlageVor funktionieren über den OpenAI-Client (inkl. Validierung + zweiter Versuch)', async () => {
    umgebung({ OPENAI_API_KEY: 'k' });
    const e = fetchMit(antwort('{"text":"Gern, hier der Link."}'));
    expect(await entwerfeAntwort({ verlauf: [{ eigene: false, text: 'Bitte um Termin' }], ctaUrl: 'https://cal.example' }, openaiClient(e.f))).toBe('Gern, hier der Link.');
    expect(JSON.parse(String(e.aufrufe[0].init.body)).input).toContain('https://cal.example');
    const v = fetchMit(antwort('{"betreff":"x","text":"Hallo {{vorschaubild}}"}'), antwort('{"betreff":"Frage zu {{firma}}","text":"{{begruessung}},\\n\\nkurz."}'));
    const r = await schlageVorlageVor({ beschreibung: 'Angebot', art: 'erstmail', mitVideo: false }, openaiClient(v.f));
    expect(r.betreff).toBe('Frage zu {{firma}}');
    expect(v.aufrufe).toHaveLength(2);
  });
});
