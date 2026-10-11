import { ImapFlow, type SearchObject } from 'imapflow';
import nodemailer from 'nodemailer';
import { GmailSendError, type GmailPostfach, type GmailSender, type PruefKontext, type ThreadErgebnis, type ThreadLader, type ThreadPruefer } from './gmail';
import { imapAdressen, ordneNachrichtenZu, normalisiereMessageId, smtpThreadId, messageIdAusThread, type ImapKandidat } from './imap-zuordnung';
import type { GmailNachricht } from './mail-parse';
import { kopfAusRoh, rohZuNachricht } from './mime-roh';
import { classifyImapError, classifySmtpError } from './smtp-fehler';
import type { Sicherheit } from './smtp-vorlagen';
import { entschluesseleZugangsdaten } from './zugangsdaten';

// SMTP-/IMAP-Treiber: Versand über nodemailer (die fertige MIME-Nachricht wird unverändert durchgereicht, damit Header,
// Message-ID und In-Reply-To exakt die sind, die die App gebaut hat), Antwort-/Bounce-Erkennung und Unibox über IMAP
// (imapflow). „Thread“ = Message-ID der Erstmail, Thread-ID `smtp:<Message-ID>`.

// ---------------------------------------------------------------- Konfiguration

export type Endpunkt = { host: string; port: number; sicherheit: Sicherheit; benutzer: string; passwort: string };
export type SmtpKonfig = { email: string; smtp: Endpunkt; imap: Endpunkt; kopieGesendet: boolean };

/** Zeitlimits (ms): Verbindungsaufbau, Begrüßung, Inaktivität; gesamte IMAP-Sitzung */
const VERBINDUNG_MS = 15_000;
const GREETING_MS = 15_000;
const SOCKET_MS = 30_000;
const IMAP_GESAMT_MS = 60_000;
/** Höchstzahl Nachrichten und Bytes je Abruf */
const MAX_NACHRICHTEN = 40;
const MAX_BYTES = 1_000_000;
const MAX_BYTES_PRUEFUNG = 65_536;

/** Liest die Verbindungsdaten eines SMTP-Postfachs (entschlüsselt die Passwörter). Wirft GmailSendError (auth). */
export function smtpKonfigVon(p: GmailPostfach): SmtpKonfig {
  const fehlt = (was: string) => new GmailSendError({ art: 'auth', meldung: `Postfach ${p.email}: ${was} – bitte unter Einstellungen → Postfächer die Zugangsdaten prüfen` });
  if (p.typ !== 'smtp') throw fehlt('kein SMTP/IMAP-Postfach');
  if (!p.zugangsdatenEnc) throw fehlt('nicht verbunden (keine Zugangsdaten gespeichert)');
  let z;
  try {
    z = entschluesseleZugangsdaten(p.zugangsdatenEnc);
  } catch {
    throw fehlt('die gespeicherten Zugangsdaten sind nicht lesbar (ENCRYPTION_KEY geändert?)');
  }
  if (!p.smtpHost || !p.smtpPort || !p.smtpSicherheit || !p.imapHost || !p.imapPort || !p.imapSicherheit) throw fehlt('Server-Angaben unvollständig');
  return {
    email: p.email,
    smtp: { host: p.smtpHost, port: p.smtpPort, sicherheit: p.smtpSicherheit, benutzer: p.smtpBenutzer || p.email, passwort: z.smtpPasswort },
    imap: { host: p.imapHost, port: p.imapPort, sicherheit: p.imapSicherheit, benutzer: p.imapBenutzer || p.email, passwort: z.imapPasswort },
    kopieGesendet: p.imapKopieGesendet ?? true,
  };
}

// ---------------------------------------------------------------- SMTP (nodemailer)

/** Das, was der Treiber von einem nodemailer-Transport braucht (in Tests ersetzbar) */
export type SmtpTransport = {
  sendMail(opt: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown>;
  verify(): Promise<unknown>;
  close(): void;
};

function erzeugeTransport(k: SmtpKonfig): SmtpTransport {
  const s = k.smtp;
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.sicherheit === 'ssl',
    requireTLS: s.sicherheit === 'starttls',
    ignoreTLS: s.sicherheit === 'keine',
    auth: { user: s.benutzer, pass: s.passwort },
    connectionTimeout: VERBINDUNG_MS,
    greetingTimeout: GREETING_MS,
    socketTimeout: SOCKET_MS,
    logger: false,
  }) as unknown as SmtpTransport;
}

// ---------------------------------------------------------------- IMAP (imapflow)

/** Suchbedingung: mindestens einer der Begriffe (ODER), optional ab einem Datum (UND). */
export type ImapSuche = {
  oder: Array<{ header: [name: string, wert: string] } | { von: string } | { koerper: string }>;
  seit?: Date;
};
export type ImapOrdner = 'INBOX' | 'GESENDET';
export type ImapRohNachricht = { uid: number; datum: number | null; quelle: Buffer };

/** Eine geöffnete IMAP-Verbindung (in Tests ersetzbar). Immer mit schliesse() beenden. */
export type ImapSitzung = {
  suche(ordner: ImapOrdner, suche: ImapSuche, opt?: { max?: number; maxBytes?: number }): Promise<ImapRohNachricht[]>;
  /** Legt eine Kopie im „Gesendet“-Ordner ab (SPECIAL-USE \Sent); false = kein Ordner gefunden */
  haengeAnGesendet(raw: Buffer): Promise<boolean>;
  schliesse(): Promise<void>;
};

function zuImapflow(s: ImapSuche): SearchObject {
  const terme: SearchObject[] = s.oder.map((t) => ('header' in t ? { header: { [t.header[0]]: t.header[1] } } : 'von' in t ? { from: t.von } : { body: t.koerper }));
  const basis: SearchObject = terme.length === 1 ? terme[0] : { or: terme };
  return s.seit ? { ...basis, since: s.seit } : basis;
}

function inMs(d: Date | string | undefined): number | null {
  if (!d) return null;
  const ms = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(ms) ? null : ms;
}

/** Öffnet eine echte IMAP-Verbindung. Wirft GmailSendError (auth bei falschen Zugangsdaten, sonst Netzwerk). */
export async function oeffneImap(k: SmtpKonfig): Promise<ImapSitzung> {
  const i = k.imap;
  const client = new ImapFlow({
    host: i.host,
    port: i.port,
    secure: i.sicherheit === 'ssl',
    // starttls: Upgrade erzwingen (nie Zugangsdaten im Klartext); keine: bewusst unverschlüsselt
    doSTARTTLS: i.sicherheit === 'starttls' ? true : i.sicherheit === 'keine' ? false : undefined,
    auth: { user: i.benutzer, pass: i.passwort },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: VERBINDUNG_MS,
    greetingTimeout: GREETING_MS,
    socketTimeout: SOCKET_MS,
  });
  // Ohne Listener würde ein Verbindungsabbruch den Prozess beenden
  client.on('error', () => {});
  // Gesamtlimit der Sitzung: danach wird hart getrennt, offene Befehle schlagen fehl
  const frist = setTimeout(() => client.close(), IMAP_GESAMT_MS);
  try {
    await client.connect();
  } catch (e) {
    clearTimeout(frist);
    client.close();
    throw new GmailSendError(classifyImapError(e));
  }
  let gesendetPfad: string | null | undefined;
  const gesendetOrdner = async (): Promise<string | null> => {
    if (gesendetPfad !== undefined) return gesendetPfad;
    const liste = await client.list();
    gesendetPfad = liste.find((m) => m.specialUse === '\\Sent')?.path ?? liste.find((m) => /^(sent|gesendet|gesendete (elemente|objekte)|sent items|sent messages)$/i.test(m.name))?.path ?? null;
    return gesendetPfad;
  };
  return {
    async suche(ordner, suche, opt = {}) {
      try {
        const pfad = ordner === 'INBOX' ? 'INBOX' : await gesendetOrdner();
        if (!pfad) return [];
        const lock = await client.getMailboxLock(pfad, { readOnly: true });
        try {
          const uids = await client.search(zuImapflow(suche), { uid: true });
          if (!uids || uids.length === 0) return [];
          const neueste = [...uids].sort((a, b) => a - b).slice(-(opt.max ?? MAX_NACHRICHTEN));
          const aus: ImapRohNachricht[] = [];
          for await (const m of client.fetch(neueste, { uid: true, internalDate: true, source: { maxLength: opt.maxBytes ?? MAX_BYTES } }, { uid: true })) {
            aus.push({ uid: m.uid, datum: inMs(m.internalDate), quelle: m.source ?? Buffer.alloc(0) });
          }
          return aus;
        } finally {
          lock.release();
        }
      } catch (e) {
        if (e instanceof GmailSendError) throw e;
        throw new GmailSendError(classifyImapError(e));
      }
    },
    async haengeAnGesendet(raw) {
      try {
        const pfad = await gesendetOrdner();
        if (!pfad) return false;
        await client.append(pfad, raw, ['\\Seen'], new Date());
        return true;
      } catch (e) {
        throw new GmailSendError(classifyImapError(e));
      }
    },
    async schliesse() {
      clearTimeout(frist);
      try {
        await client.logout();
      } catch {
        client.close();
      }
    },
  };
}

// ---------------------------------------------------------------- Treiber

export type SmtpDeps = {
  transport?: (k: SmtpKonfig) => SmtpTransport;
  imap?: (k: SmtpKonfig) => Promise<ImapSitzung>;
  log?: (msg: string) => void;
};

/** Empfängeradressen aus dem To-/Cc-Header einer Nachricht. */
function empfaenger(kopf: Record<string, string>): string[] {
  const liste = `${kopf['to'] ?? ''},${kopf['cc'] ?? ''}`;
  return imapAdressen(liste);
}

export function erzeugeSmtpTreiber(deps: SmtpDeps = {}) {
  const transportFactory = deps.transport ?? erzeugeTransport;
  const imapFactory = deps.imap ?? oeffneImap;
  const log = deps.log ?? ((m: string) => console.warn(`[smtp] ${m}`));

  const senden: GmailSender = async (raw, threadId, postfach) => {
    const k = smtpKonfigVon(postfach);
    const mime = Buffer.from(raw, 'base64url');
    const kopf = kopfAusRoh(mime);
    const messageId = (kopf['message-id'] ?? '').trim();
    const an = empfaenger(kopf);
    if (!messageId) throw new GmailSendError({ art: 'sonstig', meldung: 'Der Nachricht fehlt die Message-ID' });
    if (an.length === 0) throw new GmailSendError({ art: 'ungueltiger_empfaenger', meldung: 'Ungültige Empfängeradresse: kein Empfänger in der Nachricht' });
    const transport = transportFactory(k);
    try {
      // Die Nachricht wird 1:1 gesendet (raw); nur der Umschlag (envelope) wird gesetzt
      await transport.sendMail({ envelope: { from: k.email, to: an }, raw: mime });
    } catch (e) {
      throw new GmailSendError(classifySmtpError(e));
    } finally {
      transport.close();
    }
    // Kopie im „Gesendet“-Ordner, damit der Verlauf (Unibox) vollständig ist. Die Mail ist raus – Fehler hier sind nur ein Hinweis.
    if (k.kopieGesendet) {
      let sitzung: ImapSitzung | null = null;
      try {
        sitzung = await imapFactory(k);
        if (!(await sitzung.haengeAnGesendet(mime))) log(`${k.email}: kein „Gesendet“-Ordner gefunden – keine Kopie abgelegt`);
      } catch (e) {
        log(`${k.email}: Kopie im Gesendet-Ordner fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await sitzung?.schliesse().catch(() => {});
      }
    }
    return { id: messageId, threadId: threadId ?? smtpThreadId(messageId) };
  };

  /** Prüft einen Thread über eine bereits offene Verbindung. */
  async function pruefeMit(sitzung: ImapSitzung, threadId: string, postfach: GmailPostfach, kontext: PruefKontext = {}): Promise<ThreadErgebnis> {
    const ids = [...new Set([messageIdAusThread(threadId), ...(kontext.messageIds ?? [])].map(normalisiereMessageId).filter(Boolean))].slice(0, 8);
    if (ids.length === 0) return null;
    const seit = kontext.seit ?? null;
    const lead = (kontext.leadEmail ?? '').trim().toLowerCase();
    const oder: ImapSuche['oder'] = [];
    for (const id of ids) oder.push({ header: ['In-Reply-To', id] }, { header: ['References', id] });
    // Zustellberichte: Absender mailer-daemon/postmaster bzw. unsere Message-ID im Text (Berichte tragen die abgewiesene Mail)
    oder.push({ von: 'mailer-daemon' }, { von: 'postmaster' }, { koerper: ids[0].split('@')[0] });
    if (lead) oder.push({ von: lead });
    // Einen Tag Puffer, weil IMAP nur Datum ohne Uhrzeit/Zeitzone vergleicht
    const ab = seit ? new Date(seit - 24 * 3600_000) : undefined;
    const roh = await sitzung.suche('INBOX', { oder, ...(ab ? { seit: ab } : {}) }, { maxBytes: MAX_BYTES_PRUEFUNG });
    const kandidaten: ImapKandidat[] = roh.map((m) => ({ kopf: kopfAusRoh(m.quelle), datum: m.datum, textauszug: m.quelle.toString('latin1') }));
    return ordneNachrichtenZu(kandidaten, { eigeneAdresse: postfach.email, messageIds: ids, leadAdresse: lead || null, seit });
  }

  const mitPruefsitzung = async <T>(postfach: GmailPostfach, fn: (pruefer: ThreadPruefer) => Promise<T>): Promise<T> => {
    const k = smtpKonfigVon(postfach);
    const sitzung = await imapFactory(k);
    try {
      return await fn((threadId, p, kontext) => pruefeMit(sitzung, threadId, p, kontext));
    } finally {
      await sitzung.schliesse().catch(() => {});
    }
  };

  const pruefeThread: ThreadPruefer = (threadId, postfach, kontext) => mitPruefsitzung(postfach, (pruefer) => pruefer(threadId, postfach, kontext));

  /** Thread für die Unibox: alle Nachrichten mit Bezug auf die Message-ID aus Posteingang und Gesendet-Ordner. */
  const ladeThread: ThreadLader = async (threadId, postfach) => {
    const k = smtpKonfigVon(postfach);
    const id = normalisiereMessageId(messageIdAusThread(threadId));
    if (!id) return [];
    const sitzung = await imapFactory(k);
    try {
      const gefunden = new Map<string, GmailNachricht>();
      const bekannteIds = new Set<string>([id]);
      // Zwei Runden: Nachrichten, die sich nur auf eine spätere Mail der Kette beziehen, kommen in der zweiten dazu
      let suchIds = [id];
      for (let runde = 0; runde < 2 && suchIds.length > 0; runde++) {
        const bezug: ImapSuche['oder'] = suchIds.flatMap((x) => [{ header: ['In-Reply-To', x] }, { header: ['References', x] }] as ImapSuche['oder']);
        const gesendet: ImapSuche['oder'] = [...bezug, ...suchIds.map((x) => ({ header: ['Message-ID', x] }) as ImapSuche['oder'][number])];
        const [eingang, ausgang] = [await sitzung.suche('INBOX', { oder: bezug }), await sitzung.suche('GESENDET', { oder: gesendet })];
        const neu: string[] = [];
        for (const [ordner, liste] of [['INBOX', eingang], ['GESENDET', ausgang]] as const) {
          for (const m of liste) {
            const mid = normalisiereMessageId(kopfAusRoh(m.quelle)['message-id'] ?? '');
            const schluessel = mid || `${ordner}:${m.uid}`;
            if (gefunden.has(schluessel)) continue;
            gefunden.set(schluessel, rohZuNachricht(m.quelle, { id: schluessel, datum: m.datum, gesendet: ordner === 'GESENDET' }));
            if (mid && !bekannteIds.has(mid)) {
              bekannteIds.add(mid);
              neu.push(mid);
            }
          }
        }
        suchIds = neu.slice(0, 6);
      }
      return [...gefunden.values()];
    } finally {
      await sitzung.schliesse().catch(() => {});
    }
  };

  return {
    typ: 'smtp' as const,
    senden,
    pruefeThread,
    mitPruefsitzung,
    ladeThread,
    // Zugangsdaten gespeichert = lesbar (der Postfach-Zustand wird in lib/absender.ts bewertet)
    kannLesen: (p: GmailPostfach) => !!p.zugangsdatenEnc,
    kannAntwortenPruefen: (p: GmailPostfach) => !!p.zugangsdatenEnc,
  };
}

export const smtpTreiber = erzeugeSmtpTreiber();

// ---------------------------------------------------------------- Verbindung testen

export type TeilErgebnis = { ok: boolean; meldung: string };
export type VerbindungsTest = { smtp: TeilErgebnis; imap: TeilErgebnis };

/**
 * Prüft SMTP (Anmeldung am Server, es wird nichts gesendet) und IMAP (Anmeldung, Posteingang öffnen). Beide Teile laufen
 * unabhängig; Fehler kommen als verständliche deutsche Meldung zurück. `deps` ersetzt das Netz (Tests).
 */
export async function testeVerbindung(k: SmtpKonfig, deps: SmtpDeps = {}): Promise<VerbindungsTest> {
  const transportFactory = deps.transport ?? erzeugeTransport;
  const imapFactory = deps.imap ?? oeffneImap;
  const smtp = (async (): Promise<TeilErgebnis> => {
    const t = transportFactory(k);
    try {
      await t.verify();
      return { ok: true, meldung: `Anmeldung am SMTP-Server ${k.smtp.host}:${k.smtp.port} erfolgreich` };
    } catch (e) {
      return { ok: false, meldung: classifySmtpError(e).meldung };
    } finally {
      t.close();
    }
  })();
  const imap = (async (): Promise<TeilErgebnis> => {
    let s: ImapSitzung | null = null;
    try {
      s = await imapFactory(k);
      // Ein leerer Suchlauf im Posteingang beweist, dass er sich öffnen lässt
      await s.suche('INBOX', { oder: [{ header: ['Message-ID', 'verbindungstest.invalid'] }] }, { max: 1, maxBytes: 1024 });
      return { ok: true, meldung: `Anmeldung am IMAP-Server ${k.imap.host}:${k.imap.port} erfolgreich` };
    } catch (e) {
      return { ok: false, meldung: e instanceof GmailSendError ? e.info.meldung : classifyImapError(e).meldung };
    } finally {
      await s?.schliesse().catch(() => {});
    }
  })();
  const [a, b] = await Promise.all([smtp, imap]);
  return { smtp: a, imap: b };
}
