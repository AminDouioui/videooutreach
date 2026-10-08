// Worker: Render- und Versand-Schleife. Start: `npm run worker`
import { getDb } from '../lib/db';
import { bundleRemotion, pruefeTeaserCache, recoverRenderJobs, startRenderLoop } from './render';
import { startSendLoop } from './send';

const SHUTDOWN_MAX_MS = 30_000;

async function main() {
  getDb();
  recoverRenderJobs();
  await bundleRemotion();
  await pruefeTeaserCache();

  // Schleifen: jede liefert eine Stop-Funktion, die auf laufende Arbeit wartet
  const stoppers: Array<() => Promise<void>> = [];
  stoppers.push(startRenderLoop());
  // Versand-Schleife (worker/send.ts)
  const versand = startSendLoop();
  stoppers.push(() => versand.stop());

  console.log('[worker] Läuft – Render- und Versand-Schleife aktiv.');

  let beendet = false;
  const beenden = (signal: string) => {
    if (beendet) return;
    beendet = true;
    console.log(`[worker] ${signal} empfangen – laufende Jobs werden beendet (max. 30 s) …`);
    const limit = setTimeout(() => {
      console.warn('[worker] Zeitlimit erreicht, Abbruch. Offene Jobs werden beim Neustart wieder aufgenommen.');
      process.exit(0);
    }, SHUTDOWN_MAX_MS);
    Promise.allSettled(stoppers.map((s) => s())).then(() => {
      clearTimeout(limit);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => beenden('SIGTERM'));
  process.on('SIGINT', () => beenden('SIGINT'));
}

// Ungefangene Fehler loggen, Worker läuft weiter
process.on('uncaughtException', (e) => console.error('[worker] Ungefangener Fehler:', e));
process.on('unhandledRejection', (e) => console.error('[worker] Ungefangene Promise-Ablehnung:', e));

main().catch((e) => {
  console.error('[worker] Start fehlgeschlagen:', e);
  process.exit(1);
});
