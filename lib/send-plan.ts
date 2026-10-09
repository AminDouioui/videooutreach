import { isWithinWindow, type FensterKampagne } from './time';

// Reine Entscheidungslogik der Versandschleife (testbar ohne DB)

export type SendState = {
  /** Datum (Berlin), auf das sich sentToday bezieht */
  date: string;
  sentToday: number;
  /** Unix-ms frühester nächster Versand */
  nextSendAt: number | null;
  /** Datum (Berlin), an dem ein Quota-Fehler den Versand gestoppt hat */
  quotaStoppedDate: string | null;
};

export type PlanInput = {
  now: Date;
  today: string;
  campaign: FensterKampagne & { status: string; dailySendLimit: number; startDatum?: string | null };
  globalLimit: number;
  sentTodayGlobal: number;
  sentTodayCampaign: number;
  state: Pick<SendState, 'nextSendAt' | 'quotaStoppedDate'>;
};

export type PlanResult =
  | { action: 'send' }
  | {
      action: 'wait';
      reason: 'status' | 'vor_start' | 'quota_gestoppt' | 'fenster_zu' | 'limit_global' | 'limit_kampagne' | 'abstand';
      /** true = gilt für alle Kampagnen, Schleife kann die Runde beenden */
      global: boolean;
    };

/** Darf jetzt (für diese Kampagne) die nächste Mail raus? */
export function decideSend(i: PlanInput): PlanResult {
  if (i.campaign.status !== 'versendet_laufend') return { action: 'wait', reason: 'status', global: false };
  // Datum im Format YYYY-MM-DD: Textvergleich entspricht dem Datumsvergleich
  if (i.campaign.startDatum && i.today < i.campaign.startDatum) return { action: 'wait', reason: 'vor_start', global: false };
  if (i.state.quotaStoppedDate === i.today) return { action: 'wait', reason: 'quota_gestoppt', global: true };
  if (i.sentTodayGlobal >= i.globalLimit) return { action: 'wait', reason: 'limit_global', global: true };
  if (i.state.nextSendAt !== null && i.now.getTime() < i.state.nextSendAt) return { action: 'wait', reason: 'abstand', global: true };
  if (!isWithinWindow(i.campaign, i.now)) return { action: 'wait', reason: 'fenster_zu', global: false };
  if (i.sentTodayCampaign >= i.campaign.dailySendLimit) return { action: 'wait', reason: 'limit_kampagne', global: false };
  return { action: 'send' };
}

/** Zufälliger Abstand in ms zwischen min und max Minuten. `zufall` in [0,1). */
export function randomGapMs(minMinuten: number, maxMinuten: number, zufall: () => number = Math.random): number {
  const lo = Math.min(minMinuten, maxMinuten);
  const hi = Math.max(minMinuten, maxMinuten);
  return Math.round((lo + zufall() * (hi - lo)) * 60_000);
}
