import nodemailer from 'nodemailer';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMime, buildMimeText } from './mail';

Object.assign(process.env, {
  DATA_DIR: '/tmp/vo-smtp-treiber-unused',
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

type Mod = typeof import('./smtp-treiber');
type Enc = typeof import('./zugangsdaten');
let t: Mod;
let enc: Enc;
let gmail: typeof import('./gmail');

beforeAll(async () => {
  t = await import('./smtp-treiber');
  enc = await import('./zugangsdaten');
  gmail = await import('./gmail');
});

const MID = '<erst0001@prozessia.de>';
const mime = (extra: Partial<Parameters<typeof buildMimeText>[0]> = {}) =>
  buildMimeText({
    from: { name: 'Amin Müller', email: 'amin@prozessia.de' },
    to: 'Kunde <k@kunde.de>',
    subject: 'Hallo Firma',
    html: '<p>Hi</p>',
    text: 'Hi',
    listUnsubscribeUrl: 'https://video.example.de/api/unsubscribe/x',
    listUnsubscribeMailto: 'mailto:amin@prozessia.de?subject=Abmelden',
    messageId: MID,
    date: new Date('2026-07-15T09:00:00Z'),
    boundary: 'GRENZE',
    ...extra,
  });

function postfach(extra: Record<string, unknown> = {}) {
  return {
    id: 7,
    email: 'amin@prozessia.de',
    refreshTokenEnc: '',
    typ: 'smtp' as const,
    smtpHost: 'smtp.ionos.de',
    smtpPort: 465,
    smtpSicherheit: 'ssl' as const,
    smtpBenutzer: 'amin@prozessia.de',
    imapHost: 'imap.ionos.de',
    imapPort: 993,
    imapSicherheit: 'ssl' as const,
    imapBenutzer: null,
    zugangsdatenEnc: '',
    imapKopieGesendet: true,
    ...extra,
  };
}
const pf = (extra: Record<string, unknown> = {}) => ({ ...postfach(extra), zugangsdatenEnc: enc.verschluesseleZugangsdaten({ smtpPasswort: 'geheim-smtp', imapPasswort: 'geheim-imap' }), ...extra });

type Gesendet = { envelope: { from: string; to: string[] }; raw: Buffer };
function fakeTransport(opts: { fehler?: unknown } = {}) {
  const gesendet: Gesendet[] = [];
  let geschlossen = 0;
  let verifiziert = 0;
  const factory = () => ({
    sendMail: async (o: Gesendet) => {
      if (opts.fehler) throw opts.fehler;
      gesendet.push(o);
      return {};
    },
    verify: async () => {
      verifiziert++;
      if (opts.fehler) throw opts.fehler;
      return true;
    },
    close: () => {
      geschlossen++;
    },
  });
  return { gesendet, factory, stand: () => ({ geschlossen, verifiziert }) };
}

type Roh = { uid: number; datum: number | null; quelle: Buffer };
function fakeImap(inhalt: { INBOX?: Roh[]; GESENDET?: Roh[]; fehlerBeimOeffnen?: unknown; fehlerBeiSuche?: unknown; keinGesendet?: boolean } = {}) {
  const protokoll = { geoeffnet: 0, geschlossen: 0, suchen: [] as { ordner: string; suche: unknown }[], angehaengt: [] as Buffer[] };
  const factory = async () => {
    if (inhalt.fehlerBeimOeffnen) throw inhalt.fehlerBeimOeffnen;
    protokoll.geoeffnet++;
    return {
      async suche(ordner: 'INBOX' | 'GESENDET', suche: unknown) {
        protokoll.suchen.push({ ordner, suche });
        if (inhalt.fehlerBeiSuche) throw inhalt.fehlerBeiSuche;
        return inhalt[ordner] ?? [];
      },
      async haengeAnGesendet(raw: Buffer) {
        if (inhalt.keinGesendet) return false;
        protokoll.angehaengt.push(raw);
        return true;
      },
      async schliesse() {
        protokoll.geschlossen++;
      },
    };
  };
  return { factory, protokoll };
}
const rohMail = (kopf: string[], text = 'Hallo', datum = Date.parse('2026-07-15T10:00:00Z'), uid = 1): Roh => ({ uid, datum, quelle: Buffer.from([...kopf, '', text].join('\r\n')) });

describe('SMTP-Senden', () => {
  it('reicht die MIME-Nachricht unverändert durch und setzt den Umschlag (envelope)', async () => {
    const tr = fakeTransport();
    const treiber = t.erzeugeSmtpTreiber({ transport: tr.factory, imap: fakeImap().factory });
    const raw = buildMime({ from: { name: 'Amin Müller', email: 'amin@prozessia.de' }, to: 'Kunde <k@kunde.de>', subject: 'Hallo Firma', html: '<p>Hi</p>', text: 'Hi', listUnsubscribeUrl: 'https://x.de/u', listUnsubscribeMailto: 'mailto:amin@prozessia.de', messageId: MID, inReplyTo: '<davor@prozessia.de>' });
    const res = await treiber.senden(raw, undefined, pf());
    expect(tr.gesendet).toHaveLength(1);
    // Byte-genau dieselbe Nachricht: Header, Message-ID, In-Reply-To, References
    expect(tr.gesendet[0].raw.equals(Buffer.from(raw, 'base64url'))).toBe(true);
    const text = tr.gesendet[0].raw.toString('utf8');
    expect(text).toContain(`Message-ID: ${MID}`);
    expect(text).toContain('In-Reply-To: <davor@prozessia.de>');
    expect(text).toContain('References: <davor@prozessia.de>');
    expect(tr.gesendet[0].envelope).toEqual({ from: 'amin@prozessia.de', to: ['k@kunde.de'] });
    expect(res).toEqual({ id: MID, threadId: `smtp:${MID}` });
    expect(tr.stand().geschlossen).toBe(1);
  });

  it('Antwort im Thread behält die übergebene Thread-ID', async () => {
    const tr = fakeTransport();
    const treiber = t.erzeugeSmtpTreiber({ transport: tr.factory, imap: fakeImap().factory });
    const res = await treiber.senden(Buffer.from(mime({ messageId: '<folge@prozessia.de>' })).toString('base64url'), `smtp:${MID}`, pf());
    expect(res).toEqual({ id: '<folge@prozessia.de>', threadId: `smtp:${MID}` });
  });

  it('nodemailer selbst verändert die Rohnachricht nicht (echter Stream-Transport, kein Netz)', async () => {
    const raw = Buffer.from(mime(), 'utf8');
    const echt = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = (await echt.sendMail({ envelope: { from: 'amin@prozessia.de', to: ['k@kunde.de'] }, raw })) as unknown as { message: Buffer; envelope: { from: string; to: string[] } };
    expect(info.message.equals(raw)).toBe(true);
    expect(info.envelope).toEqual({ from: 'amin@prozessia.de', to: ['k@kunde.de'] });
  });

  it('legt eine Kopie im Gesendet-Ordner ab; ohne Ordner oder bei IMAP-Fehler gilt die Mail trotzdem als gesendet', async () => {
    const imap = fakeImap();
    const tr = fakeTransport();
    const raw = Buffer.from(mime()).toString('base64url');
    await t.erzeugeSmtpTreiber({ transport: tr.factory, imap: imap.factory }).senden(raw, undefined, pf());
    expect(imap.protokoll.angehaengt).toHaveLength(1);
    expect(imap.protokoll.angehaengt[0].toString('utf8')).toContain(`Message-ID: ${MID}`);
    expect(imap.protokoll.geoeffnet).toBe(imap.protokoll.geschlossen);

    const log: string[] = [];
    const ohneOrdner = fakeImap({ keinGesendet: true });
    await expect(t.erzeugeSmtpTreiber({ transport: tr.factory, imap: ohneOrdner.factory, log: (m) => log.push(m) }).senden(raw, undefined, pf())).resolves.toMatchObject({ id: MID });
    expect(log.join()).toMatch(/kein „Gesendet“-Ordner/);

    const kaputt = fakeImap({ fehlerBeimOeffnen: Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }) });
    await expect(t.erzeugeSmtpTreiber({ transport: tr.factory, imap: kaputt.factory, log: (m) => log.push(m) }).senden(raw, undefined, pf())).resolves.toMatchObject({ id: MID });
    expect(log.join()).toMatch(/Kopie im Gesendet-Ordner fehlgeschlagen/);
  });

  it('ohne Kopie-Option wird IMAP beim Senden gar nicht geöffnet', async () => {
    const imap = fakeImap();
    await t.erzeugeSmtpTreiber({ transport: fakeTransport().factory, imap: imap.factory }).senden(Buffer.from(mime()).toString('base64url'), undefined, pf({ imapKopieGesendet: false }));
    expect(imap.protokoll.geoeffnet).toBe(0);
  });

  it('SMTP-Fehler werden wie bei Gmail klassifiziert (GmailSendError mit Art)', async () => {
    const raw = Buffer.from(mime()).toString('base64url');
    const wirf = async (fehler: unknown) => {
      const treiber = t.erzeugeSmtpTreiber({ transport: fakeTransport({ fehler }).factory, imap: fakeImap().factory });
      return treiber.senden(raw, undefined, pf()).catch((e) => e);
    };
    const auth = await wirf({ code: 'EAUTH', responseCode: 535, response: '535 Authentication failed' });
    expect(auth).toBeInstanceOf(gmail.GmailSendError);
    expect(auth.info.art).toBe('auth');
    expect((await wirf({ responseCode: 550, response: '550 5.4.5 Daily user sending quota exceeded' })).info.art).toBe('quota');
    expect((await wirf({ responseCode: 550, response: '550 5.1.1 User unknown' })).info.art).toBe('ungueltiger_empfaenger');
    const netz = await wirf({ code: 'ECONNECTION', message: 'connect ECONNREFUSED' });
    expect(netz.info.art).toBe('sonstig');
    expect(netz.info.meldung).toMatch(/Keine Verbindung/);
  });

  it('ungültige oder fehlende Zugangsdaten → auth-Fehler mit Hinweis, ohne Netz', async () => {
    const treiber = t.erzeugeSmtpTreiber({ transport: fakeTransport().factory, imap: fakeImap().factory });
    const raw = Buffer.from(mime()).toString('base64url');
    const e1 = await treiber.senden(raw, undefined, postfach()).catch((e) => e);
    expect(e1.info.art).toBe('auth');
    const e2 = await treiber.senden(raw, undefined, { ...postfach(), zugangsdatenEnc: 'kaputt-nicht-entschluesselbar-0000000000000000000000000000' }).catch((e) => e);
    expect(e2.info.art).toBe('auth');
    expect(e2.info.meldung).toMatch(/nicht lesbar/);
    const e3 = await treiber.senden(raw, undefined, { ...pf(), typ: 'gmail' as never }).catch((e) => e);
    expect(e3.info.art).toBe('auth');
  });

  it('Nachricht ohne Empfänger oder Message-ID wird nicht gesendet', async () => {
    const tr = fakeTransport();
    const treiber = t.erzeugeSmtpTreiber({ transport: tr.factory, imap: fakeImap().factory });
    const ohneTo = await treiber.senden(Buffer.from('Message-ID: <x@y.de>\r\nSubject: a\r\n\r\nb').toString('base64url'), undefined, pf()).catch((e) => e);
    expect(ohneTo.info.art).toBe('ungueltiger_empfaenger');
    const ohneId = await treiber.senden(Buffer.from('To: a@b.de\r\n\r\nb').toString('base64url'), undefined, pf()).catch((e) => e);
    expect(ohneId.info.art).toBe('sonstig');
    expect(tr.gesendet).toHaveLength(0);
  });

  it('übergibt Host, Port, Benutzer und Passwort entschlüsselt an den Transport – nur dort', async () => {
    let gesehen: unknown;
    const treiber = t.erzeugeSmtpTreiber({
      transport: (k) => {
        gesehen = k;
        return fakeTransport().factory();
      },
      imap: fakeImap().factory,
    });
    await treiber.senden(Buffer.from(mime()).toString('base64url'), undefined, pf({ imapKopieGesendet: false }));
    expect(gesehen).toMatchObject({ email: 'amin@prozessia.de', smtp: { host: 'smtp.ionos.de', port: 465, sicherheit: 'ssl', benutzer: 'amin@prozessia.de', passwort: 'geheim-smtp' }, imap: { host: 'imap.ionos.de', port: 993, passwort: 'geheim-imap', benutzer: 'amin@prozessia.de' } });
  });
});

describe('SMTP: Antwort-Erkennung über IMAP', () => {
  const kontext = { leadEmail: 'k@kunde.de', seit: Date.parse('2026-07-15T09:00:00Z'), messageIds: [MID, '<folge@prozessia.de>'] };

  it('erkennt Antwort, Bounce und Abwesenheit aus dem Posteingang', async () => {
    const antwort = fakeImap({ INBOX: [rohMail(['From: Kunde <k@kunde.de>', `In-Reply-To: ${MID}`, 'Subject: Re: Hallo Firma'])] });
    expect(await t.erzeugeSmtpTreiber({ imap: antwort.factory }).pruefeThread(`smtp:${MID}`, pf(), kontext)).toBe('antwort');

    const bounce = fakeImap({ INBOX: [rohMail(['From: MAILER-DAEMON@mx.ionos.de', 'Subject: Undelivered Mail Returned to Sender'], `Original-Message-ID: ${MID}`)] });
    expect(await t.erzeugeSmtpTreiber({ imap: bounce.factory }).pruefeThread(`smtp:${MID}`, pf(), kontext)).toBe('bounce');

    const abwesend = fakeImap({ INBOX: [rohMail(['From: k@kunde.de', `References: ${MID}`, 'Auto-Submitted: auto-replied', 'Subject: Automatische Antwort'])] });
    expect(await t.erzeugeSmtpTreiber({ imap: abwesend.factory }).pruefeThread(`smtp:${MID}`, pf(), kontext)).toBe('abwesenheit');

    const nichts = fakeImap({ INBOX: [rohMail(['From: news@anbieter.de', 'Subject: Newsletter'])] });
    expect(await t.erzeugeSmtpTreiber({ imap: nichts.factory }).pruefeThread(`smtp:${MID}`, pf(), kontext)).toBeNull();
  });

  it('einer fremden Bounce-Mail wird nicht vertraut, auch wenn der Server sie liefert', async () => {
    const fremd = fakeImap({ INBOX: [rohMail(['From: MAILER-DAEMON@mx.ionos.de', 'Subject: Undelivered Mail Returned to Sender'], 'Message-ID: <anderer@prozessia.de>')] });
    expect(await t.erzeugeSmtpTreiber({ imap: fremd.factory }).pruefeThread(`smtp:${MID}`, pf(), kontext)).toBeNull();
  });

  it('eine Verbindung pro Prüfdurchlauf, sauber geschlossen – auch bei Fehlern', async () => {
    const imap = fakeImap();
    const treiber = t.erzeugeSmtpTreiber({ imap: imap.factory });
    const ergebnisse = await treiber.mitPruefsitzung(pf(), async (pruefer) => [await pruefer(`smtp:${MID}`, pf(), kontext), await pruefer('smtp:<zweiter@prozessia.de>', pf(), kontext), await pruefer('smtp:<dritter@prozessia.de>', pf())]);
    expect(ergebnisse).toEqual([null, null, null]);
    expect(imap.protokoll.geoeffnet).toBe(1);
    expect(imap.protokoll.geschlossen).toBe(1);
    expect(imap.protokoll.suchen).toHaveLength(3);

    const kaputt = fakeImap({ fehlerBeiSuche: new gmail.GmailSendError({ art: 'sonstig', meldung: 'Keine Verbindung' }) });
    await expect(t.erzeugeSmtpTreiber({ imap: kaputt.factory }).pruefeThread(`smtp:${MID}`, pf(), kontext)).rejects.toThrow('Keine Verbindung');
    expect(kaputt.protokoll.geschlossen).toBe(1);
  });

  it('IMAP-Anmeldefehler beim Öffnen bleiben ein GmailSendError mit Art (Aufrufer pausiert das Postfach)', async () => {
    const treiber = t.erzeugeSmtpTreiber({ imap: fakeImap({ fehlerBeimOeffnen: new gmail.GmailSendError({ art: 'auth', meldung: 'IMAP-Anmeldung fehlgeschlagen' }) }).factory });
    const e = await treiber.pruefeThread(`smtp:${MID}`, pf(), kontext).catch((x) => x);
    expect(e.info.art).toBe('auth');
  });

  it('sucht nach In-Reply-To/References aller bekannten Message-IDs und begrenzt ab der Erstmail', async () => {
    const imap = fakeImap();
    await t.erzeugeSmtpTreiber({ imap: imap.factory }).pruefeThread(`smtp:${MID}`, pf(), kontext);
    const s = imap.protokoll.suchen[0];
    expect(s.ordner).toBe('INBOX');
    const suche = s.suche as { oder: unknown[]; seit?: Date };
    expect(suche.oder).toContainEqual({ header: ['In-Reply-To', 'erst0001@prozessia.de'] });
    expect(suche.oder).toContainEqual({ header: ['References', 'folge@prozessia.de'] });
    expect(suche.oder).toContainEqual({ von: 'k@kunde.de' });
    expect(suche.seit).toBeInstanceOf(Date);
  });
});

describe('SMTP: Unibox-Verlauf über IMAP', () => {
  it('lädt Posteingang und Gesendet-Ordner, markiert eigene Mails und dedupliziert', async () => {
    const eigene = rohMail(['From: Amin <amin@prozessia.de>', 'To: k@kunde.de', 'Subject: Hallo Firma', `Message-ID: ${MID}`, 'Content-Type: text/plain; charset=utf-8'], 'Erste Mail', Date.parse('2026-07-15T09:00:00Z'), 5);
    const antwort = rohMail(['From: Kunde <k@kunde.de>', 'To: amin@prozessia.de', 'Subject: Re: Hallo Firma', 'Message-ID: <antwort@kunde.de>', `In-Reply-To: ${MID}`, `References: ${MID}`, 'Content-Type: text/plain; charset=utf-8'], 'Gern, rufen Sie an.', Date.parse('2026-07-15T12:00:00Z'), 9);
    const imap = fakeImap({ INBOX: [antwort], GESENDET: [eigene, { ...eigene, uid: 6 }] });
    const rohe = await t.erzeugeSmtpTreiber({ imap: imap.factory }).ladeThread(`smtp:${MID}`, pf());
    expect(rohe).toHaveLength(2);
    const { parseThread } = await import('./mail-parse');
    const verlauf = parseThread(rohe, 'amin@prozessia.de');
    expect(verlauf.map((n) => [n.eigene, n.text])).toEqual([
      [true, 'Erste Mail'],
      [false, 'Gern, rufen Sie an.'],
    ]);
    expect(imap.protokoll.geoeffnet).toBe(1);
    expect(imap.protokoll.geschlossen).toBe(1);
  });
});

describe('Verbindung testen', () => {
  const konfig = () => t.smtpKonfigVon(pf());

  it('meldet Erfolg für beide Teile, ohne etwas zu senden', async () => {
    const tr = fakeTransport();
    const r = await t.testeVerbindung(konfig(), { transport: tr.factory, imap: fakeImap().factory });
    expect(r.smtp).toMatchObject({ ok: true });
    expect(r.imap).toMatchObject({ ok: true });
    expect(tr.gesendet).toHaveLength(0);
    expect(tr.stand()).toEqual({ geschlossen: 1, verifiziert: 1 });
  });

  it('nicht erreichbarer Host → verständliche deutsche Meldung je Teil', async () => {
    const netz = Object.assign(new Error('getaddrinfo ENOTFOUND smtp.gibt-es-nicht.invalid'), { code: 'ENOTFOUND' });
    const r = await t.testeVerbindung(konfig(), { transport: fakeTransport({ fehler: netz }).factory, imap: fakeImap({ fehlerBeimOeffnen: new gmail.GmailSendError({ art: 'sonstig', meldung: 'Keine Verbindung zum IMAP-Server (Netzwerkfehler)' }) }).factory });
    expect(r.smtp.ok).toBe(false);
    expect(r.smtp.meldung).toMatch(/Keine Verbindung zum SMTP-Server/);
    expect(r.imap.ok).toBe(false);
    expect(r.imap.meldung).toMatch(/Keine Verbindung zum IMAP-Server/);
  });

  it('falsches Passwort nur bei SMTP: IMAP bleibt grün', async () => {
    const r = await t.testeVerbindung(konfig(), { transport: fakeTransport({ fehler: { code: 'EAUTH', responseCode: 535, response: '535 Authentication failed' } }).factory, imap: fakeImap().factory });
    expect(r.smtp.ok).toBe(false);
    expect(r.smtp.meldung).toMatch(/Anmeldung fehlgeschlagen/);
    expect(r.imap.ok).toBe(true);
  });
});
