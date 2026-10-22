// Importiert einen OffeneRegister-Dump (JSON Lines, auch .gz; .bz2 vorher entpacken) als Startbestand in die Rohdaten-Schicht.
// Nur die Zielgruppe übernehmen, der Dump hat Millionen Firmen:
//   npm run leadgen:offeneregister -- datei.jsonl --plz 70,71,72 --name "werkzeug|formenbau|maschinenbau" --limit 5000
import { getDb } from '../lib/db';
import { OffeneRegisterConnector } from '../lib/leadgen/connectors/offeneregister';
import { ingestQuelle, ladeKennzahlen } from '../lib/leadgen/ingest';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const datei = process.argv[2];
  if (!datei || datei.startsWith('--')) {
    console.error('Aufruf: npm run leadgen:offeneregister -- <datei.jsonl[.gz]> [--plz 70,71] [--name "regex"] [--limit N]');
    process.exit(1);
  }
  const plz = arg('plz')?.split(',').map((p) => p.trim()).filter(Boolean);
  const name = arg('name') ? new RegExp(arg('name')!, 'i') : null;
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const filter = (satz: Record<string, unknown>) => {
    if (name && !name.test(String(satz.name ?? ''))) return false;
    if (plz?.length) {
      const adresse = JSON.stringify([satz.registered_address, (satz.all_attributes as Record<string, unknown> | undefined)?.registered_address]);
      if (!plz.some((p) => new RegExp(`\\b${p}\\d{${5 - p.length}}\\b`).test(adresse))) return false;
    }
    return true;
  };
  getDb();
  const erg = await ingestQuelle(new OffeneRegisterConnector({ datei, filter, limit }));
  console.log('Ingestion:', erg);
  console.log('Kennzahlen:', ladeKennzahlen());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
