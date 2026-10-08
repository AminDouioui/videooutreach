// Worker-Stub (Phase 1): öffnet die DB und loggt. Render- und Versand-Schleife folgen in späteren Phasen.
import { getDb } from '../lib/db';

function main() {
  getDb();
  console.log('[worker] Datenbank geöffnet. Render- und Versand-Schleife folgen in späteren Phasen.');
}

main();
