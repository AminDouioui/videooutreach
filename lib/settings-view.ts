import { getEnv } from './env';
import { connectedEmail, isGmailConnected, kannAntwortenPruefen, oauthConfigured } from './gmail';
import { getSetting, globalDailyLimit } from './settings';

export function ladeEinstellungen() {
  const env = getEnv();
  return {
    senderName: getSetting('sender_name') ?? env.SENDER_NAME ?? '',
    signature: getSetting('signature') ?? '',
    globalDailyLimit: globalDailyLimit(),
    impressumUrl: getSetting('impressum_url') ?? env.IMPRESSUM_URL ?? '',
    datenschutzUrl: getSetting('datenschutz_url') ?? env.DATENSCHUTZ_URL ?? '',
    gmail: { connected: isGmailConnected(), email: connectedEmail(), configured: oauthConfigured(), antwortPruefung: kannAntwortenPruefen() },
  };
}
