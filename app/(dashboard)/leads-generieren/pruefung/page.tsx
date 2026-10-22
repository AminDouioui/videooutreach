import Link from 'next/link';
import { LeadgenPruefung } from '@/components/LeadgenPruefung';
import { ladePruefFaelle } from '@/lib/leadgen/pruefung';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

export default async function PruefungSeite() {
  await erforderSeitenRolle();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/leads-generieren" className="text-sm text-indigo-600 hover:underline">
          ← Leads generieren
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Unsichere Firmen-Treffer</h1>
        <p className="text-sm text-slate-500">Diese Firmen könnten dieselben sein, die Übereinstimmung reichte aber nicht für eine automatische Zusammenführung.</p>
      </div>
      <LeadgenPruefung faelle={ladePruefFaelle()} />
    </div>
  );
}
