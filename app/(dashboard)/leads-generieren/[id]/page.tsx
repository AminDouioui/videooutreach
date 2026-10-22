import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc } from 'drizzle-orm';
import { LeadgenErgebnis } from '@/components/LeadgenErgebnis';
import { LeadgenFortschritt } from '@/components/LeadgenFortschritt';
import { getDb, schema } from '@/lib/db';
import { ladeLaufStatus } from '@/lib/leadgen/lauf';
import { ladeRollenDefinitionen } from '@/lib/leadgen/standard-deps';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

export default async function LaufSeite({ params }: { params: Promise<{ id: string }> }) {
  await erforderSeitenRolle();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const status = ladeLaufStatus(id);
  if (!status) notFound();
  const kampagnen = getDb().select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).orderBy(asc(schema.campaigns.name)).all();
  const f = status.filter;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/leads-generieren" className="text-sm text-indigo-600 hover:underline">
          ← Leads generieren
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Lauf {status.id}</h1>
        <p className="text-sm text-slate-500">
          {f.branchen.length ? f.branchen.join(', ') : 'alle Branchen'} · {f.mitarbeiterMin} bis {f.mitarbeiterMax} Mitarbeiter · {f.bundeslaender.length || f.plzPraefixe.length ? [...f.bundeslaender, ...f.plzPraefixe.map((p) => `PLZ ${p}`)].join(', ') : 'ganz Deutschland'}
          {f.rechtsformen.length ? ` · ${f.rechtsformen.join(', ')}` : ''} · Zielrolle {ladeRollenDefinitionen().find((r) => r.key === f.zielRolle)?.label ?? f.zielRolle}
        </p>
      </div>
      <LeadgenFortschritt initial={status} />
      <LeadgenErgebnis runId={status.id} kampagnen={kampagnen} laeuft={status.status === 'laeuft'} start={{ mindestScore: f.mindestScore, nurVerifiziert: f.nurVerifizierteEmail }} />
    </div>
  );
}
