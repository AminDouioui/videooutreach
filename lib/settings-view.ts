import { anzahlZuordnungen, kannAntwortenPruefen, ladePostfachZustaende } from './absender';
import { getEnv } from './env';
import { oauthConfigured } from './gmail';
import { postfachStatus, type PostfachStatus } from './rotation';
import { effektivesGlobalLimit } from './send';
import { getSetting, globalDailyLimit, rampeEinstellung } from './settings';
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
  /** Kann Antworten erkennen (gmail.metadata erteilt) */
  antwortPruefung: boolean;
  rampeBeginn: string;
  leads: number;
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
    rampeBeginn: a.rampeBeginn ?? '',
    leads: anzahlZuordnungen(a.id).leads,
  }));
}

export function ladeEinstellungen() {
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
    heuteErlaubt: effektivesGlobalLimit(),
    impressumUrl: getSetting('impressum_url') ?? env.IMPRESSUM_URL ?? '',
    datenschutzUrl: getSetting('datenschutz_url') ?? env.DATENSCHUTZ_URL ?? '',
    gmailKonfiguriert: oauthConfigured(),
    postfaecher: ladePostfachListe(),
  };
}
