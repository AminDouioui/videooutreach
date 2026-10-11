import { stelleFaelligeZu } from '../lib/webhook-zustellung';
import { raeumeZustellungenAuf } from '../lib/webhooks';

// Webhook-Schleife des Workers: pollt alle 5 s, stellt fällige Zustellungen zu (Wiederholung mit Backoff siehe lib/webhook-logik.ts)
// und räumt stündlich Zustellungen älter als 30 Tage auf.
const POLL_MS = 5000;
const AUFRAEUMEN_MS = 3600_000;

export function startWebhookLoop(): { stop(): Promise<void> } {
  let gestoppt = false;
  let timer: NodeJS.Timeout | null = null;
  let laufend: Promise<void> = Promise.resolve();
  let letztesAufraeumen = 0;

  const tick = async () => {
    try {
      const n = await stelleFaelligeZu();
      if (n > 0) console.log(`[webhook] ${n} Zustellung(en) bearbeitet`);
      if (Date.now() - letztesAufraeumen >= AUFRAEUMEN_MS) {
        letztesAufraeumen = Date.now();
        const weg = raeumeZustellungenAuf();
        if (weg > 0) console.log(`[webhook] ${weg} alte Zustellung(en) gelöscht`);
      }
    } catch (e) {
      console.error('[webhook] Fehler im Zustell-Durchlauf:', e);
    }
  };

  const planen = () => {
    if (gestoppt) return;
    timer = setTimeout(() => {
      laufend = tick().finally(planen);
    }, POLL_MS);
  };
  planen();

  return {
    async stop() {
      gestoppt = true;
      if (timer) clearTimeout(timer);
      // laufenden Durchlauf zu Ende lassen (Zeitlimit je Zustellung 10 s, Gesamtlimit 30 s)
      await Promise.race([laufend, new Promise((r) => setTimeout(r, 30_000))]);
    },
  };
}
