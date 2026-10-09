import { runSendTick } from '../lib/send-loop';

// Versand-Schleife des Workers: pollt alle 3 s, sendet höchstens eine Mail pro Durchlauf (Abstand und Limits je Postfach, Rotation siehe lib/send-loop.ts).
const POLL_MS = 3000;

export function startSendLoop(): { stop(): Promise<void> } {
  let gestoppt = false;
  let timer: NodeJS.Timeout | null = null;
  let laufend: Promise<void> = Promise.resolve();

  const tick = async () => {
    try {
      await runSendTick({ log: (m) => console.log(`[send] ${m}`) });
    } catch (e) {
      // Fehler loggen, Schleife läuft weiter
      console.error('[send] Fehler im Versand-Durchlauf:', e);
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
      // laufenden Durchlauf zu Ende lassen (max. 30 s)
      await Promise.race([laufend, new Promise((r) => setTimeout(r, 30_000))]);
    },
  };
}
