import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { KiAnfrage, KiClient } from './ki';
import type { GmailNachricht } from './mail-parse';
import { legePostfachAn } from './test-postfach';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-kie-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'sec',
  SEND_MIN_GAP_MINUTES: '3',
  SEND_MAX_GAP_MINUTES: '9',
});
delete process.env.ANTHROPIC_API_KEY;

type Mods = {
  db: typeof import('./db');
  ki: typeof import('./ki-einordnung');
  routen: typeof import('./ki-routen');
  settings: typeof import('./settings');
  loop: typeof import('./send-loop');
  send: typeof import('./send');
  suppression: typeof import('./suppression');
  settingsView: typeof import('./settings-view');
};
let m: Mods;
let nr = 0;
let postfachId = 0;

const SEND = 'https://www.googleapis.com/auth/gmail.send';
const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const META = 'https://www.googleapis.com/auth/gmail.metadata';
const T0 = new Date('2026-07-15T09:00:00Z');
const b64u = (s: string) => Buffer.from(s).toString('base64url');
const nachricht = (id: string, kopf: Record<string, string>, text: string, ms: number): GmailNachricht => ({
  id,
  threadId: 'T1',
  internalDate: String(ms),
  payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }, ...Object.entries(kopf).map(([name, value]) => ({ name, value }))], body: { data: b64u(text), size: text.length } },
});
const ANTWORT_TEXT = 'Ja, das klingt interessant. Rufen Sie mich Dienstag an.';
function thread(eigen = 'amin@prozessia.de', antwort = ANTWORT_TEXT): GmailNachricht[] {
  return [
    nachricht('g1', { From: eigen, To: 'max@kunde.de', Subject: 'Ihr Video', 'Message-ID': '<e1@prozessia.de>' }, 'Hallo Max, hier Ihr Video.', 1_000),
    nachricht('g2', { From: 'Max <max@kunde.de>', To: eigen, Subject: 'Re: Ihr Video', 'Message-ID': '<k1@kunde.de>' }, `${antwort}\n\nAm 1. Okt. 2026 um 10:00 schrieb Amin <${eigen}>:\n> Hallo Max, hier Ihr Video.`, 2_000),
  ];
}
/** Client mit festen Antworten; merkt sich die Anfragen */
function fake(antwort: object | Error) {
  const anfragen: KiAnfrage[] = [];
  const ki: KiClient = async (a) => {
    anfragen.push(a);
    if (antwort instanceof Error) throw antwort;
    return JSON.stringify(antwort);
  };
  return { anfragen, ki };
}
const klasse = (kategorie: string, konfidenz = 0.95) => ({ kategorie, konfidenz, begruendung: 'Begründung.' });
const lader = (nachrichten = thread()) => async () => nachrichten;

async function neuerLead(extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}, kampagne: Partial<typeof import('@/db/schema').campaigns.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  const k = getDb().insert(schema.campaigns).values({ name: `K${nr}`, ctaUrl: 'https://cal.example/termin', emailSubjectTemplate: 'Ihr Video', emailBodyTemplate: 'b', ...kampagne }).returning().get();
  return getDb()
    .insert(schema.leads)
    .values({ campaignId: k.id, firma: `Firma ${nr}`, email: `max${nr}@kunde.de`, slug: `ki-${nr}`, sendStatus: 'gesendet', sentAt: T0, absenderId: postfachId, gmailThreadId: 'T1', flowStopp: 'beantwortet', antwortAt: T0, antwortGelesen: false, ...extra })
    .returning()
    .get();
}
const lead = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;

beforeAll(async () => {
  m = {
    db: await import('./db'),
    ki: await import('./ki-einordnung'),
    routen: await import('./ki-routen'),
    settings: await import('./settings'),
    loop: await import('./send-loop'),
    send: await import('./send'),
    suppression: await import('./suppression'),
    settingsView: await import('./settings-view'),
  };
  postfachId = (await legePostfachAn({ scopes: `${SEND} ${META} ${READ}` })).id;
});
beforeEach(async () => {
  const { leereThreadCache } = await import('./antworten');
  leereThreadCache();
  m.settings.deleteSetting('ki_auto_status');
});

describe('Einordnung speichern', () => {
  it('Standard „vorschlagen“: speichert kategorie/konfidenz/begründung/at, ändert aber nichts; es geht nur der Text ohne Zitat raus', async () => {
    const l = await neuerLead();
    const { anfragen, ki } = fake(klasse('interessiert', 0.97));
    const res = await m.ki.ordneLeadEin(l.id, { ki, lader: lader(), jetzt: T0 });
    expect(res).toMatchObject({ ok: true, angewendet: false });
    expect(lead(l.id).kiEinordnung).toEqual({ kategorie: 'interessiert', konfidenz: 0.97, begruendung: 'Begründung.', at: T0.getTime(), angewendet: false });
    expect(lead(l.id).leadStatus).toBe('offen');
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0].nutzer).toContain(ANTWORT_TEXT);
    expect(anfragen[0].nutzer).not.toContain('Hallo Max, hier Ihr Video');
    expect(anfragen[0].nutzer).not.toContain('Am 1. Okt.');
  });
  it('Modus „aus“: manuell möglich, wendet aber nie an', async () => {
    m.settings.setSetting('ki_auto_status', 'aus');
    const l = await neuerLead();
    const res = await m.ki.ordneLeadEin(l.id, { ki: fake(klasse('nicht_interessiert')).ki, lader: lader(), jetzt: T0 });
    expect(res).toMatchObject({ ok: true, angewendet: false });
    expect(lead(l.id).leadStatus).toBe('offen');
  });
  it('Fehler: ohne Lesezugriff, ohne fremde Nachricht und KI-Fehler → verständliche Meldung, nichts gespeichert', async () => {
    const ohneLesen = await legePostfachAn({ scopes: `${SEND} ${META}` });
    const a = await neuerLead({ absenderId: ohneLesen.id });
    const r1 = await m.ki.ordneLeadEin(a.id, { ki: fake(klasse('sonstiges')).ki, lader: lader() });
    expect(r1).toMatchObject({ ok: false });
    expect(r1.ok === false && r1.error).toContain('Lesezugriff');
    const b = await neuerLead();
    const nurEigene = thread().slice(0, 1);
    const r2 = await m.ki.ordneLeadEin(b.id, { ki: fake(klasse('sonstiges')).ki, lader: lader(nurEigene) });
    expect(r2.ok === false && r2.error).toContain('keine Nachricht des Leads');
    const { KiFehler } = await import('./ki');
    const r3 = await m.ki.ordneLeadEin(b.id, { ki: fake(new KiFehler('Anthropic meldet zu viele Anfragen (Rate-Limit).', 'limit', true)).ki, lader: lader() });
    expect(r3).toMatchObject({ ok: false, status: 502 });
    expect(r3.ok === false && r3.error).toContain('Rate-Limit');
    expect(lead(a.id).kiEinordnung).toBeNull();
    expect(lead(b.id).kiEinordnung).toBeNull();
  });
});

describe('Automatisch anwenden (Regeln & Konfidenzschwelle)', () => {
  beforeEach(() => m.settings.setSetting('ki_auto_status', 'automatisch'));

  it.each([
    ['interessiert', 'interessiert'],
    ['spaeter', 'spaeter'],
    ['nicht_interessiert', 'nicht_interessiert'],
    ['falscher_ansprechpartner', 'falscher_ansprechpartner'],
  ])('%s → Lead-Status %s (bei Konfidenz ≥ 0,8)', async (kategorie, status) => {
    const l = await neuerLead();
    const res = await m.ki.ordneLeadEin(l.id, { ki: fake(klasse(kategorie, 0.8)).ki, lader: lader(), jetzt: T0 });
    expect(res).toMatchObject({ ok: true, angewendet: true });
    expect(lead(l.id).leadStatus).toBe(status);
    expect(lead(l.id).kiEinordnung?.angewendet).toBe(true);
  });
  it('unter der Schwelle (0,79) nur Vorschlag; „sonstiges“ nie', async () => {
    const a = await neuerLead();
    expect(await m.ki.ordneLeadEin(a.id, { ki: fake(klasse('nicht_interessiert', 0.79)).ki, lader: lader() })).toMatchObject({ ok: true, angewendet: false });
    expect(lead(a.id).leadStatus).toBe('offen');
    expect(lead(a.id).kiEinordnung?.kategorie).toBe('nicht_interessiert');
    const b = await neuerLead();
    expect(await m.ki.ordneLeadEin(b.id, { ki: fake(klasse('sonstiges', 1)).ki, lader: lader() })).toMatchObject({ ok: true, angewendet: false });
    expect(lead(b.id).leadStatus).toBe('offen');
  });
  it('ein bereits gesetzter (manueller) Status wird nicht überschrieben', async () => {
    const l = await neuerLead({ leadStatus: 'spaeter' });
    expect(await m.ki.ordneLeadEin(l.id, { ki: fake(klasse('nicht_interessiert')).ki, lader: lader() })).toMatchObject({ ok: true, angewendet: false });
    expect(lead(l.id).leadStatus).toBe('spaeter');
  });
  it('abmeldung → wie Abmeldelink: abgemeldet, Sperrliste, offene Mails an die Adresse übersprungen', async () => {
    const l = await neuerLead();
    const offen = await neuerLead({ sendStatus: 'nicht_gesendet', flowStopp: null, email: l.email, sentAt: null });
    const res = await m.ki.ordneLeadEin(l.id, { ki: fake(klasse('abmeldung', 0.9)).ki, lader: lader() });
    expect(res).toMatchObject({ ok: true, angewendet: true });
    expect(lead(l.id).unsubscribed).toBe(true);
    expect(m.suppression.isSuppressed(l.email)).toBe(true);
    expect(lead(offen.id).sendStatus).toBe('uebersprungen');
  });
  it('abwesenheit → wie Paket 7: keine Antwort, Flow läuft weiter, Follow-ups warten N Tage, Event', async () => {
    const l = await neuerLead({}, { abwesenheitVerschiebenTage: 5 });
    const res = await m.ki.ordneLeadEin(l.id, { ki: fake(klasse('abwesenheit', 0.99)).ki, lader: lader(thread('amin@prozessia.de', 'Ich bin bis 20.7. im Urlaub.')), jetzt: T0 });
    expect(res).toMatchObject({ ok: true, angewendet: true });
    const x = lead(l.id);
    expect(x.flowStopp).toBeNull();
    expect(x.antwortAt).toBeNull();
    expect(x.abwesendAt?.getTime()).toBe(T0.getTime());
    expect(x.abwesendBis?.getTime()).toBe(T0.getTime() + 5 * 24 * 3600_000);
    const ev = m.db.getDb().select().from(m.db.schema.events).where(eq(m.db.schema.events.leadId, l.id)).all();
    expect(ev.map((e) => e.type)).toContain('abwesenheit');
  });
  it('„Vorschlag übernehmen“ ignoriert die Schwelle und überschreibt den Status', async () => {
    m.settings.setSetting('ki_auto_status', 'vorschlagen');
    const l = await neuerLead({ leadStatus: 'spaeter' });
    await m.ki.ordneLeadEin(l.id, { ki: fake(klasse('interessiert', 0.5)).ki, lader: lader(), jetzt: T0 });
    expect(lead(l.id).leadStatus).toBe('spaeter');
    expect(m.ki.uebernimmEinordnung(l.id, T0)).toEqual({ ok: true, angewendet: true });
    expect(lead(l.id).leadStatus).toBe('interessiert');
    expect(lead(l.id).kiEinordnung?.angewendet).toBe(true);
    const ohne = await neuerLead();
    expect(m.ki.uebernimmEinordnung(ohne.id)).toMatchObject({ ok: false, status: 409 });
  });
});

describe('Antwortpfad & Warteschlange: Fehlertoleranz', () => {
  it('KI-Fehler blockiert die Antwort-Erkennung nie: Flow endet, Antwort ist erkannt', async () => {
    // Leads aus früheren Tests gelten als gerade geprüft, damit der Durchlauf genau diesen Lead prüft
    m.db.getDb().update(m.db.schema.leads).set({ replyCheckedAt: T0, kiVersuche: 3 }).run();
    const k = await neuerLead({ flowStopp: null, antwortAt: null, kiVersuche: 0 }, { status: 'versendet_laufend' });
    const kaputt = async (): Promise<string> => {
      throw new Error('Netz weg');
    };
    const res = await m.loop.runSendTick({ pruefer: async () => 'antwort', ki: kaputt, lader: lader(), now: T0, zufall: () => 0 });
    expect(res.error).toBeUndefined();
    const x = lead(k.id);
    expect(x.flowStopp).toBe('beantwortet');
    expect(x.antwortAt).not.toBeNull();
    expect(x.kiVersuche).toBe(1); // die KI wurde versucht, der Fehler blieb folgenlos
  });
  it('Warteschlange fängt Fehler ab, zählt Versuche, wartet n*10 min und gibt nach 3 Versuchen auf', async () => {
    const l = await neuerLead({ antwortAt: T0 });
    // Andere offene Antworten des Tests nicht stören
    m.db.getDb().update(m.db.schema.leads).set({ kiVersuche: 3 }).where(eq(m.db.schema.leads.flowStopp, 'beantwortet')).run();
    m.db.getDb().update(m.db.schema.leads).set({ kiVersuche: 0, kiVersuchAt: null, kiEinordnung: null }).where(eq(m.db.schema.leads.id, l.id)).run();
    const { KiFehler } = await import('./ki');
    const kaputt = fake(new KiFehler('Der KI-Dienst ist gerade überlastet.', 'ueberlast', true));
    const min = (n: number) => new Date(T0.getTime() + n * 60_000);
    const logs: string[] = [];
    const lauf = (jetzt: Date) => m.ki.verarbeiteKiWarteschlange({ ki: kaputt.ki, lader: lader(), jetzt, log: (s) => logs.push(s) });

    expect(await lauf(min(1))).toBe(l.id); // Versuch 1
    expect(lead(l.id).kiVersuche).toBe(1);
    expect(await lauf(min(5))).toBeNull(); // zu früh (Wartezeit 10 min)
    expect(await lauf(min(12))).toBe(l.id); // Versuch 2
    expect(await lauf(min(20))).toBeNull(); // 2 * 10 min
    expect(await lauf(min(40))).toBe(l.id); // Versuch 3
    expect(lead(l.id).kiVersuche).toBe(3);
    expect(await lauf(min(500))).toBeNull(); // nie mehr
    expect(kaputt.anfragen).toHaveLength(3);
    expect(lead(l.id).kiEinordnung).toBeNull();
    expect(logs).toHaveLength(3);
    expect(logs.join('\n')).not.toContain(ANTWORT_TEXT); // keine Mailinhalte im Log
  });
  it('Erfolg beim Wiederholen speichert; danach keine weitere Anfrage', async () => {
    const l = await neuerLead({ antwortAt: T0 });
    m.db.getDb().update(m.db.schema.leads).set({ kiVersuche: 3 }).where(eq(m.db.schema.leads.flowStopp, 'beantwortet')).run();
    m.db.getDb().update(m.db.schema.leads).set({ kiVersuche: 1, kiVersuchAt: T0, kiEinordnung: null }).where(eq(m.db.schema.leads.id, l.id)).run();
    const gut = fake(klasse('spaeter', 0.9));
    expect(await m.ki.verarbeiteKiWarteschlange({ ki: gut.ki, lader: lader(), jetzt: new Date(T0.getTime() + 11 * 60_000) })).toBe(l.id);
    expect(lead(l.id).kiEinordnung?.kategorie).toBe('spaeter');
    expect(await m.ki.verarbeiteKiWarteschlange({ ki: gut.ki, lader: lader(), jetzt: new Date(T0.getTime() + 60 * 60_000) })).toBeNull();
    expect(gut.anfragen).toHaveLength(1);
  });
  it('tut nichts bei Einstellung „aus“, ohne Lesezugriff, ohne Schlüssel/Client und für alte Antworten', async () => {
    const x = await neuerLead({ antwortAt: T0 });
    m.db.getDb().update(m.db.schema.leads).set({ kiVersuche: 3 }).where(eq(m.db.schema.leads.flowStopp, 'beantwortet')).run();
    m.db.getDb().update(m.db.schema.leads).set({ kiVersuche: 0, kiVersuchAt: null, kiEinordnung: null }).where(eq(m.db.schema.leads.id, x.id)).run();
    const f = fake(klasse('sonstiges'));
    m.settings.setSetting('ki_auto_status', 'aus');
    expect(await m.ki.verarbeiteKiWarteschlange({ ki: f.ki, lader: lader(), jetzt: T0 })).toBeNull();
    m.settings.deleteSetting('ki_auto_status');
    expect(await m.ki.verarbeiteKiWarteschlange({ lader: lader(), jetzt: T0 })).toBeNull(); // kein Client, kein Schlüssel
    expect(await m.ki.verarbeiteKiWarteschlange({ ki: f.ki, lader: lader(), jetzt: new Date(T0.getTime() + 30 * 24 * 3600_000) })).toBeNull(); // 30 Tage alt
    const ohneLesen = await legePostfachAn({ scopes: `${SEND} ${META}` });
    m.db.getDb().update(m.db.schema.leads).set({ absenderId: ohneLesen.id }).where(eq(m.db.schema.leads.id, x.id)).run();
    expect(await m.ki.verarbeiteKiWarteschlange({ ki: f.ki, lader: lader(), jetzt: T0 })).toBeNull();
    expect(f.anfragen).toHaveLength(0);
  });
});

describe('Routen', () => {
  const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const post = (body?: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  it('ohne Schlüssel: 404 mit Meldung, keine KI-Anfrage, keine Gmail-Zugriffe', async () => {
    const l = await neuerLead();
    let gmail = 0;
    const opt = { lader: async () => (gmail++, thread()) };
    for (const h of [m.routen.einordnenHandler(opt), m.routen.entwurfHandler(opt), m.routen.uebernehmenHandler(opt)]) {
      const res = await h(post(), ctx(l.id));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toContain('ANTHROPIC_API_KEY');
    }
    const v = await m.routen.vorlageHandler()(post({ beschreibung: 'x', art: 'erstmail' }), ctx(l.campaignId));
    expect(v.status).toBe(404);
    expect(gmail).toBe(0);
    expect(m.settingsView.ladeEinstellungen().kiAktiv).toBe(false);
  });
  it('mit Client: einordnen, übernehmen und Entwurf', async () => {
    m.settings.setSetting('ki_auto_status', 'vorschlagen');
    const l = await neuerLead();
    const f = fake(klasse('interessiert', 0.9));
    const ein = await m.routen.einordnenHandler({ ki: f.ki, lader: lader() })(post(), ctx(l.id));
    expect(ein.status).toBe(200);
    expect((await ein.json()).einordnung.kategorie).toBe('interessiert');
    const uebernommen = await m.routen.uebernehmenHandler({ ki: f.ki })(post(), ctx(l.id));
    expect((await uebernommen.json()).angewendet).toBe(true);
    expect(lead(l.id).leadStatus).toBe('interessiert');
    const entwurf = fake({ text: 'Gern am Dienstag, hier der Link.' });
    const e = await m.routen.entwurfHandler({ ki: entwurf.ki, lader: lader() })(post(), ctx(l.id));
    expect(await e.json()).toEqual({ ok: true, text: 'Gern am Dienstag, hier der Link.' });
    expect(entwurf.anfragen[0].nutzer).toContain('https://cal.example/termin');
    expect(lead(l.id).antwortGelesen).toBe(false); // Entwurf sendet und ändert nichts
  });
  it('Fehler der KI → verständliche Meldung statt Absturz; unbekannter Lead 404', async () => {
    const l = await neuerLead();
    const { KiFehler } = await import('./ki');
    const res = await m.routen.entwurfHandler({ ki: fake(new KiFehler('Der Anthropic-API-Schlüssel ist ungültig oder hat keine Berechtigung. Bitte ANTHROPIC_API_KEY prüfen.', 'schluessel')).ki, lader: lader() })(post(), ctx(l.id));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('ungültig');
    expect((await m.routen.einordnenHandler({ ki: fake({}).ki })(post(), ctx(999_999))).status).toBe(404);
  });
  it('Vorlagen-Vorschlag: validiert das Ergebnis, Eingabe wird geprüft', async () => {
    const l = await neuerLead({}, { mitVideo: false });
    const gut = fake({ betreff: 'Frage zu {{firma}}', text: '{{begruessung}},\n\nkurz zu unserem Angebot.' });
    const ok = await m.routen.vorlageHandler({ ki: gut.ki })(post({ beschreibung: 'Angebot X', art: 'erstmail', spintax: false }), ctx(l.campaignId));
    expect(await ok.json()).toEqual({ ok: true, betreff: 'Frage zu {{firma}}', text: '{{begruessung}},\n\nkurz zu unserem Angebot.' });
    const video = fake({ betreff: 'x', text: 'Hallo {{vorschaubild}}' });
    const schlecht = await m.routen.vorlageHandler({ ki: video.ki })(post({ beschreibung: 'Angebot X', art: 'erstmail' }), ctx(l.campaignId));
    expect(schlecht.status).toBe(422);
    expect(video.anfragen).toHaveLength(2); // zweiter Versuch
    expect((await m.routen.vorlageHandler({ ki: gut.ki })(post({ beschreibung: '', art: 'erstmail' }), ctx(l.campaignId))).status).toBe(400);
    expect((await m.routen.vorlageHandler({ ki: gut.ki })(post({ beschreibung: 'x', art: 'erstmail' }), ctx(999_999))).status).toBe(404);
  });
});
