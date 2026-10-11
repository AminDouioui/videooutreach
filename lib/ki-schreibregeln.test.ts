import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { KiAnfrage, KiClient } from './ki';
import type { GmailNachricht } from './mail-parse';
import { legePostfachAn } from './test-postfach';

// Schreibregeln in den KI-Funktionen: Regeln im Prompt, Prüfung des Ergebnisses, ein zweiter Versuch mit Hinweis,
// bei bleibendem Verstoß Ausgabe mit Warnung; Schlussgruß wird entfernt.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-kisr-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'sec',
});
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'BRAIN_URL', 'BRAIN_API_TOKEN']) delete process.env[k];

type Mods = { ki: typeof import('./ki'); kie: typeof import('./ki-einordnung'); routen: typeof import('./ki-routen'); settings: typeof import('./settings'); db: typeof import('./db') };
let m: Mods;
let postfachId = 0;

/** Client, der der Reihe nach vorbereitete Antworten liefert (die letzte wiederholt sich) */
function folge(...antworten: object[]) {
  const anfragen: KiAnfrage[] = [];
  const ki: KiClient = async (a) => {
    anfragen.push(a);
    return JSON.stringify(antworten[Math.min(anfragen.length - 1, antworten.length - 1)]);
  };
  return { anfragen, ki };
}
const W = { beschreibung: 'Angebote automatisieren', art: 'erstmail' as const, mitVideo: false };
const SAUBER = { betreff: 'Angebote für {{firma}}', text: '{{begruessung}},\n\nwir automatisieren Angebote: schnell und sicher.\n\nPasst ein kurzes Gespräch?' };
const MIT_STRICH = { betreff: 'Angebote für {{firma}}', text: '{{begruessung}},\n\nwir automatisieren Angebote – schnell und sicher.' };
const verlauf = [{ eigene: false, text: 'Das klingt interessant, bitte melden Sie sich.' }];

beforeAll(async () => {
  m = { ki: await import('./ki'), kie: await import('./ki-einordnung'), routen: await import('./ki-routen'), settings: await import('./settings'), db: await import('./db') };
  postfachId = (await legePostfachAn({ scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly', name: 'Sebastian Spuhler' })).id;
});

describe('schlageVorlageVor mit Schreibregeln', () => {
  it('Regeln stehen im System-Prompt, sauberes Ergebnis kommt ohne Retry und ohne Verstöße', async () => {
    const { anfragen, ki } = folge(SAUBER);
    const v = await m.ki.schlageVorlageVor(W, ki, { schreibregeln: true });
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0].system).toContain('keine Gedankenstriche');
    expect(v).toEqual(SAUBER);
  });

  it('Gedankenstrich im ersten Ergebnis: zweiter Versuch mit Hinweis, sauberes Ergebnis wird geliefert', async () => {
    const { anfragen, ki } = folge(MIT_STRICH, SAUBER);
    const v = await m.ki.schlageVorlageVor(W, ki, { schreibregeln: true });
    expect(anfragen).toHaveLength(2);
    expect(anfragen[0].nutzer).not.toContain('Schreibregeln');
    expect(anfragen[1].nutzer).toContain('verletzte die Schreibregeln');
    expect(anfragen[1].nutzer).toContain('Gedankenstrich');
    expect(v).toEqual(SAUBER);
    expect(v.verstoesse).toBeUndefined();
  });

  it('bleibt der Verstoß, kommt der Vorschlag mit Warnung (kein Fehler, nur zwei Versuche)', async () => {
    const { anfragen, ki } = folge(MIT_STRICH);
    const v = await m.ki.schlageVorlageVor(W, ki, { schreibregeln: true });
    expect(anfragen).toHaveLength(2);
    expect(v.text).toContain('–');
    expect(v.verstoesse?.map((x) => x.regel)).toEqual(['gedankenstrich']);
  });

  it('behauptetes Gespräch löst ebenfalls den zweiten Versuch aus', async () => {
    const { anfragen, ki } = folge({ betreff: 'Angebote', text: '{{begruessung}},\n\nwie telefonisch besprochen melde ich mich.' }, SAUBER);
    const v = await m.ki.schlageVorlageVor(W, ki, { schreibregeln: true });
    expect(anfragen).toHaveLength(2);
    expect(anfragen[1].nutzer).toContain('verletzte die Schreibregeln');
    expect(v).toEqual(SAUBER);
  });

  it('Platzhalter, Spintax und Links lösen keinen Retry aus', async () => {
    const text = { betreff: 'Hallo {{vorname|zusammen}}', text: '{{begruessung}},\n\n{Hallo|Guten Tag} {{vorname|zusammen}}, hier: https://x.de/a_(b)/c\n\n{{video_link}}' };
    const { anfragen, ki } = folge(text);
    const v = await m.ki.schlageVorlageVor({ ...W, mitVideo: true }, ki, { schreibregeln: true });
    expect(anfragen).toHaveLength(1);
    expect(v.verstoesse).toBeUndefined();
  });

  it('ohne Option: Verhalten wie bisher (keine Prüfung, kein Regeltext im Prompt)', async () => {
    const { anfragen, ki } = folge(MIT_STRICH);
    const v = await m.ki.schlageVorlageVor(W, ki);
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0].system).not.toContain('Gedankenstriche');
    expect(v).toEqual(MIT_STRICH);
  });

  it('harte Probleme (unbekannter Platzhalter) bleiben ein Fehler, auch neben Schreibregeln', async () => {
    const { ki } = folge({ betreff: 'x', text: '{{begruessung}} – {{unbekannt}}' });
    await expect(m.ki.schlageVorlageVor(W, ki, { schreibregeln: true })).rejects.toThrow('nicht verwendbar');
  });
});

describe('entwerfeAntwortGeprueft', () => {
  const wunsch = { verlauf, ctaUrl: 'https://cal.example/t', absenderName: 'Sebastian Spuhler' };

  it('entfernt einen getippten Schlussgruß mit Namen', async () => {
    const { anfragen, ki } = folge({ text: 'Gern am Dienstag.\n\nBeste Grüße\nSebastian Spuhler\nProzessia' });
    const r = await m.ki.entwerfeAntwortGeprueft(wunsch, ki, { schreibregeln: true });
    expect(r).toEqual({ text: 'Gern am Dienstag.', verstoesse: [] });
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0].system).toContain('Schreibe keinen Schlussgruß');
    expect(anfragen[0].system).not.toContain('Grußformel am Ende ist ok');
  });

  it('Verstoß: zweiter Versuch mit Hinweis, danach sauberer Text', async () => {
    const { anfragen, ki } = folge({ text: 'Gern (am Dienstag) – passt.' }, { text: 'Gern am Dienstag, das passt.' });
    const r = await m.ki.entwerfeAntwortGeprueft(wunsch, ki, { schreibregeln: true });
    expect(anfragen).toHaveLength(2);
    expect(anfragen[1].nutzer).toContain('Klammern');
    expect(r).toEqual({ text: 'Gern am Dienstag, das passt.', verstoesse: [] });
  });

  it('bleibender Verstoß: Entwurf mit Warnung, genau zwei Versuche', async () => {
    const { anfragen, ki } = folge({ text: 'Wie besprochen schicke ich Ihnen den Link – gern.' });
    const r = await m.ki.entwerfeAntwortGeprueft(wunsch, ki, { schreibregeln: true });
    expect(anfragen).toHaveLength(2);
    expect(r.verstoesse.map((x) => x.regel).sort()).toEqual(['gedankenstrich', 'gespraech']);
    expect(r.text).toContain('Wie besprochen');
  });

  it('ohne Schreibregeln: genau ein Aufruf, Text unverändert (mit Gruß)', async () => {
    const { anfragen, ki } = folge({ text: 'Gern – am Dienstag.\n\nBeste Grüße' });
    const r = await m.ki.entwerfeAntwortGeprueft(wunsch, ki);
    expect(anfragen).toHaveLength(1);
    expect(r.text).toContain('Beste Grüße');
    expect(r.verstoesse).toEqual([]);
    expect(await m.ki.entwerfeAntwort(wunsch, async () => JSON.stringify({ text: 'Hallo – Welt' }))).toBe('Hallo – Welt');
  });
});

describe('Einstellung schreibregeln_aktiv', () => {
  const T0 = 1_000;
  const b64u = (s: string) => Buffer.from(s).toString('base64url');
  const nachricht = (id: string, kopf: Record<string, string>, text: string, ms: number): GmailNachricht => ({
    id,
    threadId: 'T1',
    internalDate: String(ms),
    payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }, ...Object.entries(kopf).map(([name, value]) => ({ name, value }))], body: { data: b64u(text), size: text.length } },
  });
  const lader = async () => [
    nachricht('g1', { From: 'amin@prozessia.de', To: 'max@kunde.de', Subject: 'Ihr Video', 'Message-ID': '<e1@prozessia.de>' }, 'Hallo Max.', T0),
    nachricht('g2', { From: 'Max <max@kunde.de>', To: 'amin@prozessia.de', Subject: 'Re: Ihr Video', 'Message-ID': '<k1@kunde.de>' }, 'Interessant, melden Sie sich.', T0 + 1000),
  ];
  async function lead() {
    const { getDb, schema } = m.db;
    const k = getDb().insert(schema.campaigns).values({ name: 'KS', mitVideo: false, ctaUrl: 'https://cal.example/t', emailSubjectTemplate: 's', emailBodyTemplate: 'b' }).returning().get();
    return getDb().insert(schema.leads).values({ campaignId: k.id, firma: 'F', email: 'max@kunde.de', slug: `sr-${Math.random()}`, sendStatus: 'gesendet', absenderId: postfachId, gmailThreadId: 'T1', flowStopp: 'beantwortet' }).returning().get();
  }

  it('Standard: an (Prompt mit Regeln, Retry, Schlussgruß weg)', async () => {
    expect(m.settings.schreibregelnAktiv()).toBe(true);
    const { anfragen, ki } = folge({ text: 'Gern – Dienstag.\n\nViele Grüße\nSebastian' }, { text: 'Gern am Dienstag.\n\nViele Grüße\nSebastian' });
    const l = await lead();
    const r = await m.kie.entwerfeLeadAntwort(l.id, { ki, lader });
    expect(r).toMatchObject({ ok: true, text: 'Gern am Dienstag.', verstoesse: [] });
    expect(anfragen).toHaveLength(2);
  });

  it('abgeschaltet: wie bisher, ein Aufruf, keine Prüfung', async () => {
    m.settings.setSetting('schreibregeln_aktiv', '0');
    try {
      expect(m.settings.schreibregelnAktiv()).toBe(false);
      const { anfragen, ki } = folge({ text: 'Gern – Dienstag.' });
      const l = await lead();
      const r = await m.kie.entwerfeLeadAntwort(l.id, { ki, lader });
      expect(r).toMatchObject({ ok: true, text: 'Gern – Dienstag.', verstoesse: [] });
      expect(anfragen).toHaveLength(1);
    } finally {
      m.settings.deleteSetting('schreibregeln_aktiv');
    }
  });

  it('Vorlagen-Route reicht Verstöße an die Oberfläche durch', async () => {
    const { ki } = folge(MIT_STRICH);
    const l = await lead();
    const h = m.routen.vorlageHandler({ ki });
    const res = await h(new Request('https://x/api', { method: 'POST', body: JSON.stringify({ beschreibung: 'Angebote', art: 'erstmail' }) }), { params: Promise.resolve({ id: String(l.campaignId) }) });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.verstoesse).toHaveLength(1);
    expect(body.verstoesse[0]).toMatchObject({ regel: 'gedankenstrich' });
  });
});
