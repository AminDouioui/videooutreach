import { getEnv } from './env';
import { connectedEmail, isGmailConnected, kannAntwortenPruefen, oauthConfigured } from './gmail';
import { effektivesGlobalLimit } from './send';
import { getSetting, globalDailyLimit, rampeEinstellung } from './settings';

export function ladeEinstellungen() {
  const env = getEnv();
  const rampe = rampeEinstellung();
  return {
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
    gmail: { connected: isGmailConnected(), email: connectedEmail(), configured: oauthConfigured(), antwortPruefung: kannAntwortenPruefen() },
  };
}
