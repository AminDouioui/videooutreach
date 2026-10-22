import { getDb } from '../lib/db';
import { gibHaengendeJobsFrei } from '../lib/leadgen/queue';
import { zeitplanTick } from '../lib/leadgen/refresh';
import { erzeugeStandardDeps } from '../lib/leadgen/standard-deps';
import { verarbeiteNaechstenJob } from '../lib/leadgen/stufen';

// Worker-Schleife der Lead-Pipeline: nimmt fällige Jobs aus `pipeline_jobs` und führt sie nacheinander aus (ein Job zur Zeit, damit
// Crawler und SMTP-Prüfung höflich bleiben). Fehler wiederholt queue.ts mit Backoff; hängende Jobs eines früheren Prozesses werden beim Start freigegeben.
const LEERLAUF_MS = 3000;

export function startLeadgenLoop(): { stop(): Promise<void> } {
  let gestoppt = false;
  let timer: NodeJS.Timeout | null = null;
  let laufend: Promise<void> = Promise.resolve();

  const frei = gibHaengendeJobsFrei(15 * 60_000, Date.now(), getDb());
  if (frei > 0) console.log(`[leadgen] ${frei} hängende Job(s) wieder freigegeben`);

  const tick = async () => {
    try {
      // Fällige Auffrischungen planen (höchstens stündlich) und den Golden Record täglich neu berechnen (Decay)
      const z = zeitplanTick();
      if (z.geplant > 0) console.log(`[leadgen] ${z.geplant} Firma/Firmen zur Auffrischung eingeplant`);
      // Solange Arbeit da ist, ohne Pause weiter
      while (!gestoppt && (await verarbeiteNaechstenJob(erzeugeStandardDeps))) {
        /* nächster Job */
      }
    } catch (e) {
      console.error('[leadgen] Fehler im Durchlauf:', e);
    }
  };
  const planen = () => {
    if (gestoppt) return;
    timer = setTimeout(() => {
      laufend = tick().finally(planen);
    }, LEERLAUF_MS);
  };
  planen();

  return {
    async stop() {
      gestoppt = true;
      if (timer) clearTimeout(timer);
      await Promise.race([laufend, new Promise((r) => setTimeout(r, 30_000))]);
    },
  };
}
