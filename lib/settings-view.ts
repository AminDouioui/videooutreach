import { anzahlZuordnungen, kannAntwortenPruefen, kannThreadLesen, ladePostfachZustaende } from './absender';
import { getEnv } from './env';
import { oauthConfigured } from './gmail';
import { postfachStatus, type PostfachStatus } from './rotation';
import { effektivesGlobalLimit } from './send';
import { klassifizierungVerfuegbar, schreibhilfeVerfuegbar } from './ki';
import { bounceSchwellePostfach, jevAnbieter, getSetting, KI_ANBIETER, kiSchluesselMitQuelle, maskiereSchluessel, type KiAnbieter, type KiSchluesselQuelle, globalDailyLimit, kiAutoStatus, kiEntwurfAnbieter, kiKlassifizierer, rampeEinstellung, schreibregelnAktiv, verfuegbareEntwurfAnbieter, verfuegbareKlassifizierer } from './settings';
import type { Sicherheit } from './smtp-vorlagen';
import { todayBerlin } from './time';

export type PostfachAnzeige = {
  id: number;
  email: string;
  /** Eigener Name (leer = Standard-Absendername) */
  name: string;
  status: PostfachStatus;
  verbunden: boolean;
  aktiv: boolean;
  fehler: string | null;
  tageslimit: number;
  /** Effektives Limit heute (min aus Tageslimit und Rampe) */
  limitHeute: number;
  heuteGesendet: number;
  /** Eigene Signatur (leer = Standard-Signatur) */
  signatur: string;
  /** Kann Antworten erkennen (Gmail: gmail.metadata erteilt; SMTP: IMAP-Zugang vorhanden) */
  antwortPruefung: boolean;
  /** Unibox kann den Verlauf lesen (Gmail: gmail.readonly erteilt; SMTP: IMAP-Zugang vorhanden) */
  unibox: boolean;
  rampeBeginn: string;
  leads: number;
  /** Postfach-Typ: Gmail (OAuth) oder SMTP/IMAP */
  typ: 'gmail' | 'smtp';
  /** Nur SMTP/IMAP: Verbindungsangaben OHNE Passwörter (die verlassen den Server nie) */
  smtp: { host: string; port: number; sicherheit: Sicherheit; benutzer: string } | null;
  imap: { host: string; port: number; sicherheit: Sicherheit; benutzer: string; kopieGesendet: boolean } | null;
};

export function ladePostfachListe(jetzt: Date = new Date()): PostfachAnzeige[] {
  const heute = todayBerlin(jetzt);
  return ladePostfachZustaende(jetzt).map(({ absender: a, zustand: z }) => ({
    id: a.id,
    email: a.email,
    name: a.name ?? '',
    status: postfachStatus(z, heute),
    verbunden: z.verbunden,
    aktiv: a.aktiv,
    fehler: a.fehler,
    tageslimit: a.tageslimit,
    limitHeute: z.limit,
    heuteGesendet: z.heuteGesendet,
    signatur: a.signatur ?? '',
    antwortPruefung: kannAntwortenPruefen(a),
    unibox: kannThreadLesen(a),
    rampeBeginn: a.rampeBeginn ?? '',
    leads: anzahlZuordnungen(a.id).leads,
    typ: a.typ,
    smtp: a.typ === 'smtp' && a.smtpHost && a.smtpPort && a.smtpSicherheit ? { host: a.smtpHost, port: a.smtpPort, sicherheit: a.smtpSicherheit, benutzer: a.smtpBenutzer ?? a.email } : null,
    imap: a.typ === 'smtp' && a.imapHost && a.imapPort && a.imapSicherheit ? { host: a.imapHost, port: a.imapPort, sicherheit: a.imapSicherheit, benutzer: a.imapBenutzer ?? a.email, kopieGesendet: a.imapKopieGesendet } : null,
  }));
}

/** Zustand eines KI-Schlüssels für die Oberfläche: nie der Schlüssel selbst. `maske` („…abcd“) nur für Admins. */
export type KiSchluesselStatus = { gesetzt: boolean; quelle: KiSchluesselQuelle | null; maske: string | null; appGespeichert: boolean };

export function kiSchluesselStatus(mitMaske: boolean): Record<KiAnbieter, KiSchluesselStatus> {
  const aus = {} as Record<KiAnbieter, KiSchluesselStatus>;
  for (const a of KI_ANBIETER) {
    const k = kiSchluesselMitQuelle(a);
    aus[a] = { gesetzt: !!k, quelle: k?.quelle ?? null, maske: k && mitMaske ? maskiereSchluessel(k.schluessel) : null, appGespeichert: k?.quelle === 'app' };
  }
  return aus;
}

/** `mitMaske`: nur Admins sehen die letzten 4 Zeichen der Schlüssel; alle anderen nur „gesetzt“. */
export function ladeEinstellungen(mitMaske = false) {
  const env = getEnv();
  const rampe = rampeEinstellung();
  return {
    // Standardwerte für Postfächer ohne eigenen Namen bzw. eigene Signatur
    senderName: getSetting('sender_name') ?? env.SENDER_NAME ?? '',
    signature: getSetting('signature') ?? '',
    globalDailyLimit: globalDailyLimit(),
    rampeAktiv: rampe.aktiv,
    rampeStart: rampe.start,
    rampeSchritt: rampe.schritt,
    // Leer = automatisch (erste gesendete Mail)
    rampeBeginn: rampe.beginn ?? '',
    bounceSchwellePostfach: bounceSchwellePostfach(),
    heuteErlaubt: effektivesGlobalLimit(),
    impressumUrl: getSetting('impressum_url') ?? env.IMPRESSUM_URL ?? '',
    datenschutzUrl: getSetting('datenschutz_url') ?? env.DATENSCHUTZ_URL ?? '',
    schreibregelnAktiv: schreibregelnAktiv(),
    gmailKonfiguriert: oauthConfigured(),
    // KI-Funktionen (optional): ohne Schlüssel ist alles aus und unsichtbar. kiAktiv = irgendeine KI-Funktion verfügbar (Einordnung: Anthropic oder
    // Jev), kiSchreibhilfe = Schreibhilfe/Entwurf (OpenAI oder Anthropic)
    kiAktiv: klassifizierungVerfuegbar() || schreibhilfeVerfuegbar(),
    kiSchreibhilfe: schreibhilfeVerfuegbar(),
    kiAutoStatus: kiAutoStatus(),
    kiKlassifizierer: kiKlassifizierer(),
    kiKlassifiziererOptionen: verfuegbareKlassifizierer(),
    kiEntwurfAnbieter: kiEntwurfAnbieter(),
    kiEntwurfAnbieterOptionen: verfuegbareEntwurfAnbieter(),
    // Schlüssel nie im Klartext; Modelle: Einstellung in der App (leer = Standard)
    kiSchluessel: kiSchluesselStatus(mitMaske),
    openaiModell: getSetting('openai_model') ?? '',
    jevModell: getSetting('jev_modell') ?? '',
    typesafeModell: getSetting('typesafe_modell') ?? '',
    typesafeModellStandard: env.TYPESAFE_JEV_MODELL,
    jevAnbieter: jevAnbieter(),
    openaiModellStandard: env.OPENAI_MODEL,
    jevModellStandard: env.JEV_MODELL,
    postfaecher: ladePostfachListe(),
  };
}
