import Link from 'next/link';

const sekundaer = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50';
const gesperrt = 'cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-400';

/** Aktionsleiste der Kampagne. Platzhalter-Buttons werden in späteren Phasen aktiviert. */
export function CampaignActions({ campaignId, leadCount }: { campaignId: number; leadCount: number }) {
  const platzhalter = (label: string) => (
    <button key={label} disabled title="Folgt in einer späteren Phase" className={gesperrt}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/kampagnen/${campaignId}/import`} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
        Leads importieren
      </Link>
      {leadCount > 0 && platzhalter('Alle rendern')}
      {platzhalter('Fehlgeschlagene erneut rendern')}
      {platzhalter('Versand starten')}
      {platzhalter('Vorlage bearbeiten')}
      {platzhalter('CSV-Export')}
      <Link href="/" className={sekundaer}>
        Zur Übersicht
      </Link>
    </div>
  );
}
