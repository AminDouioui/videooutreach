import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn } from './test-postfach';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-smtp-pf-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SEND_MIN_GAP_MINUTES: '3',
  SEND_MAX_GAP_MINUTES: '9',
});

type Mods = {
  db: typeof import('./db');
  loop: typeof import('./send-loop');
  send: typeof import('./send');
  absender: typeof import('./absender');
  smtp: typeof import('./absender-smtp');
  treiber: typeof import('./postfach-treiber');
  smtpTreiber: typeof import('./smtp-treiber');
  zugang: typeof import('./zugangsdaten');
  campaigns: typeof import('./campaigns');
  antworten: typeof import('./antworten');
  view: typeof import('./settings-view');
  gmail: typeof import('./gmail');
  settings: typeof import('./settings');
};
let m: Mods;
let nr = 0;

const T0 = new Date('2026-07-15T09:00:00Z'); // Mittwoch 11:00 Berlin
const MIN = 60_000;
const nach = (ms: number) => new Date(T0.getTime() + ms);
const zufall = () => 0;

const NEU = {
  email: 'Vertrieb@Firma-S.de',
  smtpHost: 'smtp.ionos.de',
  smtpPort: 465,
  smtpSicherheit: 'ssl' as const,
  smtpPasswort: 'streng-geheim-smtp-4711',
  imapHost: 'imap.ionos.de',
  imapPort: 993,
  imapSicherheit: 'ssl' as const,
  imapPasswort: 'streng-geheim-imap-0815',
};

/** Gefälschter nodemailer-Transport */
function fakeTransport() {
  const gesendet: { envelope: { from: string; to: string[] }; raw: Buffer }[] = [];
  return { gesendet, factory: () => ({ sendMail: async (o: { envelope: { from: string; to: string[] }; raw: Buffer }) => (gesendet.push(o), {}), verify: async () => true, close: () => {} }) };
}
type Roh = { uid: number; datum: number | null; quelle: Buffer };
/** Gefälschtes IMAP mit festem Inhalt je Ordner; zählt Verbindungen */
function fakeImap(inhalt: () => { INBOX?: Roh[]; GESENDET?: Roh[] } = () => ({})) {
  const p = { geoeffnet: 0, geschlossen: 0 };
  return {
    p,
    factory: async () => {
      p.geoeffnet++;
      return {
        suche: async (ordner: 'INBOX' | 'GESENDET') => inhalt()[ordner] ?? [],
        haengeAnGesendet: async () => true,
        schliesse: async () => {
          p.geschlossen++;
        },
      };
    },
  };
}
const rohMail = (kopf: string[], text: string, ms: number, uid = 1): Roh => ({ uid, datum: ms, quelle: Buffer.from([...kopf, '', text].join('\r\n')) });

function neueKampagne(extra: Partial<typeof import('@/db/schema').campaigns.$inferInsert> = {}) {
  return m.db
    .getDb()
    .insert(m.db.schema.campaigns)
    .values({ name: 'SMTP', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}\n\nViele Grüße', status: 'versendet_laufend', dailySendLimit: 100, mitVideo: false, ...extra })
    .returning()
    .get();
}
function neuerLead(campaignId: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  nr++;
  return m.db
    .getDb()
    .insert(m.db.schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `p${nr}@kunde.de`, slug: `smtp-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant', ...extra })
    .returning()
    .get();
}
const lead = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;
const absenderZeile = (id: number) => m.db.getDb().select().from(m.db.schema.absender).where(eq(m.db.schema.absender.id, id)).get()!;

beforeAll(async () => {
  m = {
    db: await import('./db'),
    loop: await import('./send-loop'),
    send: await import('./send'),
    absender: await import('./absender'),
    smtp: await import('./absender-smtp'),
    treiber: await import('./postfach-treiber'),
    smtpTreiber: await import('./smtp-treiber'),
    zugang: await import('./zugangsdaten'),
    campaigns: await import('./campaigns'),
    antworten: await import('./antworten'),
    view: await import('./settings-view'),
    gmail: await import('./gmail'),
    settings: await import('./settings'),
  };
  m.db.getDb();
});

beforeEach(() => {
  const { getDb, schema } = m.db;
  getDb().update(schema.campaigns).set({ status: 'pausiert' }).run();
  getDb().delete(schema.sentMessages).run();
  getDb().delete(schema.leads).run();
  getDb().delete(schema.absender).run();
  m.settings.setSetting('global_daily_limit', '1000');
  m.settings.setSetting('rampe_aktiv', '0');
  m.treiber.setzeTreiberFuerTests('smtp', null);
  m.treiber.setzeTreiberFuerTests('gmail', null);
});

describe('Treiber-Auswahl', () => {
  it('Bestand ohne Typ und Gmail → Gmail-Treiber, smtp → SMTP-Treiber', () => {
    expect(m.treiber.treiberFuer({}).typ).toBe('gmail');
    expect(m.treiber.treiberFuer({ typ: 'gmail' }).typ).toBe('gmail');
    expect(m.treiber.treiberFuer({ typ: 'smtp' }).typ).toBe('smtp');
  });
  it('Gmail-Treiber ist die bisherige Implementierung', () => {
    const g = m.treiber.treiberFuer({ typ: 'gmail' });
    expect(g.senden).toBe(m.gmail.sendRaw);
    expect(g.pruefeThread).toBe(m.gmail.pruefeThread);
    expect(g.ladeThread).toBe(m.gmail.holeThreadRoh);
  });
  it('Tests können Treiber ersetzen und wiederherstellen', () => {
    const fake = { ...m.treiber.treiberFuer({ typ: 'smtp' }), typ: 'smtp' as const };
    m.treiber.setzeTreiberFuerTests('smtp', fake);
    expect(m.treiber.treiberFuer({ typ: 'smtp' })).toBe(fake);
    m.treiber.setzeTreiberFuerTests('smtp', null);
    expect(m.treiber.treiberFuer({ typ: 'smtp' })).not.toBe(fake);
  });
  it('kannLesen/kannAntwortenPruefen folgen dem Typ: Gmail über Scopes, SMTP über gespeicherte Zugangsdaten', async () => {
    const g = await legePostfachAn({ email: 'g@x.de', scopes: 'https://www.googleapis.com/auth/gmail.send' });
    expect(m.absender.kannAntwortenPruefen(g)).toBe(false);
    expect(m.absender.kannThreadLesen(g)).toBe(false);
    const s = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    expect(m.absender.kannAntwortenPruefen(s)).toBe(true);
    expect(m.absender.kannThreadLesen(s)).toBe(true);
    expect(m.treiber.treiberFuer(s).kannLesen(s)).toBe(true);
    expect(m.treiber.treiberFuer(g).kannLesen(g)).toBe(false);
    expect(m.absender.kannAntwortenPruefen({ ...s, zugangsdatenEnc: '' })).toBe(false);
  });
});

describe('Zugangsdaten verschlüsselt speichern', () => {
  it('Passwörter stehen nur verschlüsselt (ein JSON) in der DB, nirgends im Klartext', () => {
    const a = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const zeile = absenderZeile(a.id);
    expect(zeile.typ).toBe('smtp');
    expect(zeile.email).toBe('vertrieb@firma-s.de');
    expect(zeile.zugangsdatenEnc).not.toBe('');
    expect(JSON.stringify(zeile)).not.toContain(NEU.smtpPasswort);
    expect(JSON.stringify(zeile)).not.toContain(NEU.imapPasswort);
    expect(m.zugang.entschluesseleZugangsdaten(zeile.zugangsdatenEnc)).toEqual({ smtpPasswort: NEU.smtpPasswort, imapPasswort: NEU.imapPasswort });
    // Benutzer-Vorgabe: E-Mail-Adresse
    expect(zeile.smtpBenutzer).toBe('vertrieb@firma-s.de');
    expect(zeile.imapBenutzer).toBe('vertrieb@firma-s.de');
    // Rohdaten der SQLite-Datei enthalten die Klartext-Passwörter ebenfalls nicht
    const sqlite = new Database(path.join(dir, 'app.db'), { readonly: true });
    const roh = sqlite.prepare('select zugangsdaten_enc, refresh_token_enc from absender where id = ?').get(a.id) as Record<string, string>;
    sqlite.close();
    expect(Object.values(roh).join()).not.toContain('streng-geheim');
  });
  it('fehlt das IMAP-Passwort, gilt das SMTP-Passwort für beide', () => {
    const a = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse({ ...NEU, imapPasswort: undefined }));
    expect(m.zugang.entschluesseleZugangsdaten(a.zugangsdatenEnc).imapPasswort).toBe(NEU.smtpPasswort);
  });
  it('mit falschem Schlüssel nicht lesbar', async () => {
    const { encrypt } = await import('./crypto');
    const enc = encrypt('{"smtpPasswort":"a","imapPasswort":"b"}', Buffer.alloc(32, 1));
    expect(() => m.zugang.entschluesseleZugangsdaten(enc)).toThrow();
  });
  it('doppelte Adresse → 409 mit Hinweis, Eingaben werden geprüft', () => {
    m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    expect(() => m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU))).toThrowError(/existiert bereits/);
    expect(m.smtp.smtpNeuSchema.safeParse({ ...NEU, smtpHost: 'https://smtp.x.de/pfad' }).success).toBe(false);
    expect(m.smtp.smtpNeuSchema.safeParse({ ...NEU, smtpPort: 70000 }).success).toBe(false);
    expect(m.smtp.smtpNeuSchema.safeParse({ ...NEU, smtpSicherheit: 'tls' }).success).toBe(false);
    expect(m.smtp.smtpNeuSchema.safeParse({ ...NEU, smtpPasswort: '' }).success).toBe(false);
    expect(m.smtp.smtpNeuSchema.safeParse({ ...NEU, email: 'keine-adresse' }).success).toBe(false);
  });
  it('Bearbeiten: leere Passwörter lassen die gespeicherten unverändert, neue ersetzen sie, Fehler wird aufgehoben', () => {
    const a = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    m.absender.markiereAuthFehler(a.id, 'SMTP-Anmeldung fehlgeschlagen');
    const vorher = absenderZeile(a.id).zugangsdatenEnc;
    m.smtp.aktualisiereSmtpPostfach(a.id, { smtpHost: 'smtp.neu.de', smtpPasswort: '', imapPasswort: '' });
    const danach = absenderZeile(a.id);
    expect(danach.zugangsdatenEnc).toBe(vorher);
    expect(danach.smtpHost).toBe('smtp.neu.de');
    expect(danach.fehler).toBeNull();
    m.smtp.aktualisiereSmtpPostfach(a.id, { smtpPasswort: 'neu-neu-neu' });
    expect(m.zugang.entschluesseleZugangsdaten(absenderZeile(a.id).zugangsdatenEnc)).toEqual({ smtpPasswort: 'neu-neu-neu', imapPasswort: NEU.imapPasswort });
  });
  it('Bounce-Schutz-Pause bleibt beim Bearbeiten bestehen; Gmail-Postfach lehnt SMTP-Felder ab', async () => {
    const a = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const { BOUNCE_FEHLER_PREFIX } = await import('./bounce-schutz');
    m.absender.markiereAuthFehler(a.id, `${BOUNCE_FEHLER_PREFIX}: 12 % der letzten 50 Mails`);
    m.smtp.aktualisiereSmtpPostfach(a.id, { imapPort: 143 });
    expect(absenderZeile(a.id).fehler).toBeTruthy();
    const g = await legePostfachAn({ email: 'gm@x.de' });
    expect(() => m.smtp.aktualisiereSmtpPostfach(g.id, { smtpHost: 'x.de' })).toThrowError(/kein SMTP\/IMAP-Postfach/);
  });
  it('Entfernen löscht die Zugangsdaten (mit Leads: getrennt, ohne: Zeile gelöscht)', () => {
    const a = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const k = neueKampagne();
    neuerLead(k.id, { absenderId: a.id, sendStatus: 'gesendet' });
    expect(m.absender.entferneAbsender(a.id)).toBe('getrennt');
    const z = absenderZeile(a.id);
    expect(z.zugangsdatenEnc).toBe('');
    expect(m.absender.postfachVerbunden(z)).toBe(false);
    expect(m.absender.postfachNichtNutzbar(z)).toMatch(/pausiert/);
    // Neu eintragen = wieder verbunden und aktiv
    m.smtp.aktualisiereSmtpPostfach(a.id, { smtpPasswort: 'wieder-da' });
    expect(m.absender.postfachVerbunden(absenderZeile(a.id))).toBe(true);
    expect(absenderZeile(a.id).aktiv).toBe(true);
  });
  it('dieselbe Adresse lässt sich nicht zusätzlich per Gmail-OAuth verbinden', () => {
    m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    expect(() => m.absender.speichereVerbindung({ email: 'vertrieb@firma-s.de', refreshTokenEnc: 'x', scopes: 'y' })).toThrowError(/bereits als SMTP\/IMAP-Postfach/);
  });
  it('die Postfach-Liste für die Oberfläche enthält keine Passwörter, aber Typ und Serverangaben', () => {
    m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const liste = m.view.ladePostfachListe();
    const json = JSON.stringify(liste);
    expect(json).not.toContain('streng-geheim');
    expect(json).not.toMatch(/passwort|zugangsdaten/i);
    expect(liste[0]).toMatchObject({ typ: 'smtp', smtp: { host: 'smtp.ionos.de', port: 465, sicherheit: 'ssl' }, imap: { host: 'imap.ionos.de', port: 993 }, antwortPruefung: true, unibox: true, verbunden: true });
  });
  it('konfigFuerTest nimmt gespeicherte Passwörter bei leeren Feldern, überschreibt aber Server', () => {
    const a = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const k = m.smtp.konfigFuerTest(m.smtp.smtpTestSchema.parse({ absenderId: a.id, smtpPasswort: '', smtpHost: 'smtp.test.de' }));
    expect(k.smtp).toMatchObject({ host: 'smtp.test.de', passwort: NEU.smtpPasswort, benutzer: 'vertrieb@firma-s.de' });
    expect(k.imap.passwort).toBe(NEU.imapPasswort);
    expect(() => m.smtp.konfigFuerTest(m.smtp.smtpTestSchema.parse({ email: 'a@b.de', smtpHost: 'x.de', smtpPort: 587, smtpSicherheit: 'starttls', imapHost: 'y.de', imapPort: 993, imapSicherheit: 'ssl' }))).toThrowError(/SMTP-Passwort fehlt/);
  });
});

describe('Rotation über gemischte Postfächer (Gmail + SMTP)', () => {
  it('rotiert Erstmails abwechselnd; jedes Postfach sendet über seinen eigenen Treiber, Zähler und Abstand je Postfach', async () => {
    const g = await legePostfachAn({ email: 'g@firma-g.de', name: 'Gerda' });
    const s = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse({ ...NEU, name: 'Sven' }));
    const tr = fakeTransport();
    m.treiber.setzeTreiberFuerTests('smtp', m.smtpTreiber.erzeugeSmtpTreiber({ transport: tr.factory, imap: fakeImap().factory }));
    const gmailGesendet: { postfachId: number; raw: string }[] = [];
    m.treiber.setzeTreiberFuerTests('gmail', {
      ...m.treiber.treiberFuer({ typ: 'gmail' }),
      senden: async (raw, _t, p) => (gmailGesendet.push({ postfachId: p.id, raw: Buffer.from(raw, 'base64url').toString() }), { id: `g${gmailGesendet.length}`, threadId: `gt${gmailGesendet.length}` }),
    });
    const k = neueKampagne();
    const leads = [1, 2, 3, 4].map(() => neuerLead(k.id));
    const tick = (now: Date) => m.loop.runSendTick({ now, zufall });

    expect((await tick(T0)).sent).toBe(1); // gleicher Stand → kleinere ID (Gmail)
    expect((await tick(nach(1000))).sent).toBe(1); // Gmail im Abstand → SMTP
    expect((await tick(nach(3 * MIN))).sent).toBe(1);
    expect((await tick(nach(3 * MIN + 1000))).sent).toBe(1);

    expect(leads.map((l) => lead(l.id).absenderId)).toEqual([g.id, s.id, g.id, s.id]);
    expect(gmailGesendet.map((x) => x.postfachId)).toEqual([g.id, g.id]);
    expect(tr.gesendet).toHaveLength(2);
    // SMTP-Mail: Absender des SMTP-Postfachs, Umschlag, Message-ID-Domain
    const smtpText = tr.gesendet[0].raw.toString('utf8');
    expect(smtpText).toContain('From: "Sven" <vertrieb@firma-s.de>');
    expect(smtpText).toMatch(/^Message-ID: <[0-9a-f]+@firma-s\.de>$/m);
    expect(tr.gesendet[0].envelope).toEqual({ from: 'vertrieb@firma-s.de', to: [leads[1].email] });
    // Thread-ID des SMTP-Leads: smtp:<Message-ID>, rfcMessageId gespeichert
    const l2 = lead(leads[1].id);
    expect(l2.rfcMessageId).toMatch(/^<[0-9a-f]+@firma-s\.de>$/);
    expect(l2.gmailThreadId).toBe(`smtp:${l2.rfcMessageId}`);
    expect(l2.gmailMessageId).toBe(l2.rfcMessageId);
    // Zähler je Postfach
    const gezaehlt = m.db.getDb().select().from(m.db.schema.sentMessages).all().map((x) => x.absenderId);
    expect(gezaehlt).toEqual([g.id, s.id, g.id, s.id]);
  });

  it('Tageslimit gilt für SMTP-Postfächer genauso; Auth-Fehler pausiert nur dieses Postfach, das andere sendet weiter', async () => {
    const s = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse({ ...NEU, tageslimit: 1 }));
    const g = await legePostfachAn({ email: 'g2@firma-g.de' });
    const tr = fakeTransport();
    m.treiber.setzeTreiberFuerTests('smtp', m.smtpTreiber.erzeugeSmtpTreiber({ transport: tr.factory, imap: fakeImap().factory }));
    const gmailText: number[] = [];
    m.treiber.setzeTreiberFuerTests('gmail', { ...m.treiber.treiberFuer({ typ: 'gmail' }), senden: async (_r, _t, p) => (gmailText.push(p.id), { id: 'g', threadId: 'gt' }) });
    // SMTP zuerst (Gmail pausiert), Limit 1
    m.absender.aktualisiereAbsender(g.id, { aktiv: false });
    const k = neueKampagne();
    const [l1, l2] = [neuerLead(k.id), neuerLead(k.id)];
    expect((await m.loop.runSendTick({ now: T0, zufall })).sent).toBe(1);
    expect(lead(l1.id).absenderId).toBe(s.id);
    const r = await m.loop.runSendTick({ now: nach(5 * MIN), zufall });
    expect(r.sent).toBe(0);
    expect(r.waiting).toContain(`${k.id}:limit_postfach`);
    // Gmail wieder aktiv: übernimmt
    m.absender.aktualisiereAbsender(g.id, { aktiv: true });
    expect((await m.loop.runSendTick({ now: nach(10 * MIN), zufall })).sent).toBe(1);
    expect(lead(l2.id).absenderId).toBe(g.id);

    // SMTP-Anmeldefehler beim Senden pausiert das Postfach mit Meldung; die Mail bleibt für ein anderes Postfach geplant
    m.treiber.setzeTreiberFuerTests('smtp', m.smtpTreiber.erzeugeSmtpTreiber({ transport: () => ({ sendMail: async () => { throw { code: 'EAUTH', responseCode: 535, response: '535 Authentication failed' }; }, verify: async () => true, close: () => {} }), imap: fakeImap().factory }));
    m.db.getDb().update(m.db.schema.absender).set({ tageslimit: 50 }).where(eq(m.db.schema.absender.id, s.id)).run();
    m.absender.aktualisiereAbsender(g.id, { aktiv: false });
    const l3 = neuerLead(k.id);
    const r2 = await m.loop.runSendTick({ now: nach(20 * MIN), zufall });
    expect(r2.sent).toBe(0);
    expect(r2.error).toMatch(/SMTP-Anmeldung fehlgeschlagen/);
    expect(absenderZeile(s.id).fehler).toMatch(/SMTP-Anmeldung fehlgeschlagen/);
    expect(lead(l3.id).sendStatus).toBe('geplant');
    expect(m.absender.postfachNichtNutzbar(absenderZeile(s.id))).toMatch(/Zugangsdaten prüfen/);
  });
});

describe('Follow-up über dasselbe SMTP-Postfach', () => {
  it('sendet das Follow-up im Thread (In-Reply-To = Message-ID der Erstmail), prüft vorher per IMAP und stoppt bei einer Antwort', async () => {
    const s = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    // Zweites SMTP-Postfach, das nie senden darf (Follow-up gehört ins Postfach der Erstmail)
    m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse({ ...NEU, email: 'anderes@firma-s.de' }));
    m.absender.aktualisiereAbsender(s.id + 1, { aktiv: false });
    const tr = fakeTransport();
    let imapInhalt: { INBOX?: Roh[] } = {};
    const imap = fakeImap(() => imapInhalt);
    m.treiber.setzeTreiberFuerTests('smtp', m.smtpTreiber.erzeugeSmtpTreiber({ transport: tr.factory, imap: imap.factory }));
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Kurz nachgehakt.' }]);
    const l = neuerLead(k.id);
    const l2 = neuerLead(k.id);

    expect((await m.loop.runSendTick({ now: T0, zufall })).sent).toBe(1);
    expect((await m.loop.runSendTick({ now: nach(5 * MIN), zufall })).sent).toBe(1);
    const erst = lead(l.id);
    const erst2 = lead(l2.id);
    expect(erst.absenderId).toBe(s.id);
    const tag2 = new Date(T0.getTime() + 2 * 24 * 3600_000 + 10 * MIN);

    // Lead 2 hat geantwortet (Posteingang enthält eine Mail mit In-Reply-To), Lead 1 nicht
    imapInhalt = { INBOX: [rohMail(['From: Kunde <' + erst2.email + '>', `In-Reply-To: ${erst2.rfcMessageId}`, 'Subject: Re: Hallo'], 'Passt.', tag2.getTime() - 3600_000)] };
    const r = await m.loop.runSendTick({ now: tag2, zufall });
    // Reihenfolge: Lead 1 zuerst fällig (älteste Mail) – Follow-up geht raus, weil seine Prüfung nichts findet
    expect(r.sent).toBe(1);
    const folge = tr.gesendet[2].raw.toString('utf8');
    expect(folge).toContain(`In-Reply-To: ${erst.rfcMessageId}`);
    expect(folge).toContain(`References: ${erst.rfcMessageId}`);
    expect(folge).toContain('Subject: Re: Hallo');
    expect(tr.gesendet[2].envelope).toEqual({ from: 'vertrieb@firma-s.de', to: [erst.email] });
    expect(lead(l.id).followupsSent).toBe(1);
    // Das Follow-up gehört zum Thread der Erstmail, im Versandprotokoll steht seine eigene Message-ID
    const protokoll = m.db.getDb().select().from(m.db.schema.sentMessages).all().filter((x) => x.leadId === l.id);
    expect(protokoll.map((x) => x.step)).toEqual([0, 1]);
    expect(protokoll[1].gmailThreadId).toBe(erst.gmailThreadId);
    expect(protokoll[1].gmailMessageId).toMatch(/^<[0-9a-f]+@firma-s\.de>$/);
    expect(protokoll.every((x) => x.absenderId === s.id)).toBe(true);

    // Lead 2: Antwort erkannt → Flow beendet, kein Follow-up
    const r2 = await m.loop.runSendTick({ now: new Date(tag2.getTime() + 5 * MIN), zufall });
    expect(r2.sent).toBe(0);
    expect(lead(l2.id).flowStopp).toBe('beantwortet');
    expect(lead(l2.id).followupsSent).toBe(0);
    expect(tr.gesendet).toHaveLength(3);
    // jede Prüfung öffnete eine Verbindung und schloss sie wieder
    expect(imap.p.geoeffnet).toBe(imap.p.geschlossen);
  });

  it('erkennt einen Bounce im Hintergrund und stoppt den Flow', async () => {
    m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const tr = fakeTransport();
    let inhalt: { INBOX?: Roh[] } = {};
    m.treiber.setzeTreiberFuerTests('smtp', m.smtpTreiber.erzeugeSmtpTreiber({ transport: tr.factory, imap: fakeImap(() => inhalt).factory }));
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 3, body: 'Nachfassen' }]);
    const l = neuerLead(k.id);
    await m.loop.runSendTick({ now: T0, zufall });
    const erst = lead(l.id);
    inhalt = { INBOX: [rohMail(['From: MAILER-DAEMON@mx.ionos.de', 'Subject: Undelivered Mail Returned to Sender'], `Reporting-MTA: dns; mx\r\nOriginal-Message-ID: ${erst.rfcMessageId}`, T0.getTime() + 60_000)] };
    // Hintergrundprüfung (kein Versand fällig) nach einer Stunde
    await m.loop.runSendTick({ now: nach(2 * 3600_000), zufall });
    expect(lead(l.id).flowStopp).toBe('bounce');
  });
});

describe('Unibox-Antwort über SMTP', () => {
  it('liest den Verlauf per IMAP und antwortet über SMTP mit In-Reply-To/References auf die letzte Kundenmail', async () => {
    const s = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const MID = '<erst7@firma-s.de>';
    const k = neueKampagne();
    const l = neuerLead(k.id, { absenderId: s.id, sendStatus: 'gesendet', gmailThreadId: `smtp:${MID}`, rfcMessageId: MID, flowStopp: 'beantwortet', sentAt: T0 });
    const eigene = rohMail(['From: Amin <vertrieb@firma-s.de>', `To: ${l.email}`, 'Subject: Hallo Firma', `Message-ID: ${MID}`, 'Content-Type: text/plain; charset=utf-8'], 'Erste Mail', T0.getTime());
    const kunde = rohMail([`From: Kunde <${l.email}>`, 'To: vertrieb@firma-s.de', 'Subject: Re: Hallo Firma', 'Message-ID: <k1@kunde.de>', `In-Reply-To: ${MID}`, `References: ${MID}`, 'Content-Type: text/plain; charset=utf-8'], 'Klingt gut, Dienstag passt.', T0.getTime() + 3600_000);
    const tr = fakeTransport();
    const imap = fakeImap(() => ({ INBOX: [kunde], GESENDET: [eigene] }));
    m.treiber.setzeTreiberFuerTests('smtp', m.smtpTreiber.erzeugeSmtpTreiber({ transport: tr.factory, imap: imap.factory }));

    const verlauf = await m.antworten.ladeLeadThread(l.id, null);
    expect(verlauf).toMatchObject({ ok: true, threadId: `smtp:${MID}` });
    if (!verlauf.ok) throw new Error('unerreichbar');
    expect(verlauf.nachrichten.map((n) => [n.eigene, n.text])).toEqual([
      [true, 'Erste Mail'],
      [false, 'Klingt gut, Dienstag passt.'],
    ]);

    m.antworten.leereThreadCache();
    const res = await m.antworten.sendeAntwort(l.id, 'Super, bis Dienstag!', null, { now: nach(4 * 3600_000) });
    expect(res).toMatchObject({ ok: true, threadId: `smtp:${MID}` });
    expect(tr.gesendet).toHaveLength(1);
    const text = tr.gesendet[0].raw.toString('utf8');
    expect(text).toContain('In-Reply-To: <k1@kunde.de>');
    expect(text).toContain(`References: ${MID} <k1@kunde.de>`);
    expect(text).toContain('Subject: Re: Hallo Firma');
    expect(tr.gesendet[0].envelope).toEqual({ from: 'vertrieb@firma-s.de', to: [l.email] });
    // protokolliert als persönliche Antwort (zählt nicht gegen Limits)
    const zeilen = m.db.getDb().select().from(m.db.schema.sentMessages).all();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].step).toBeLessThan(0);
    expect(zeilen[0].absenderId).toBe(s.id);
  });

  it('IMAP nicht erreichbar → verständliche deutsche Meldung statt Absturz', async () => {
    const s = m.smtp.legeSmtpPostfachAn(m.smtp.smtpNeuSchema.parse(NEU));
    const k = neueKampagne();
    const l = neuerLead(k.id, { absenderId: s.id, sendStatus: 'gesendet', gmailThreadId: 'smtp:<x@firma-s.de>' });
    m.treiber.setzeTreiberFuerTests('smtp', m.smtpTreiber.erzeugeSmtpTreiber({ imap: async () => { throw new m.gmail.GmailSendError({ art: 'sonstig', meldung: 'Keine Verbindung zum IMAP-Server (Netzwerkfehler) – Host und Port prüfen bzw. später erneut versuchen.' }); } }));
    const v = await m.antworten.ladeLeadThread(l.id, null, { frisch: true });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/Keine Verbindung zum IMAP-Server/);
  });
});
