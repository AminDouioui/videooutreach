import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { FollowupEditor } from '@/components/FollowupEditor';
import { TemplateEditor } from '@/components/TemplateEditor';
import { VariantenEditor } from '@/components/VariantenEditor';
import { kampagnenExtraSpalten } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { ladeAbsender, postfachNichtNutzbar } from '@/lib/absender';
import { ladeAlleAnhaenge } from '@/lib/anhaenge-db';
import { ladeFollowupVarianten } from '@/lib/followup-varianten-db';
import { schreibhilfeVerfuegbar } from '@/lib/ki';
import { ladeFollowups } from '@/lib/send';
import { schreibregelnAktiv } from '@/lib/settings';
import { STANDARD_VARIANTE } from '@/lib/varianten';
import { ladeVarianten, variantenZaehler } from '@/lib/varianten-db';
import { Schreibschutz } from '@/components/Schreibschutz';
import { hatRolle } from '@/lib/auth';
import { erforderSeitenRolle } from '@/lib/seiten-zugriff';

export const dynamic = 'force-dynamic';

export default async function VorlagePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await erforderSeitenRolle();
  const gesperrt = !hatRolle(me.rolle, 'mitglied');
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const k = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) notFound();
  const leads = db.select().from(schema.leads).where(eq(schema.leads.campaignId, id)).orderBy(asc(schema.leads.id)).limit(500).all();
  const leadOptionen = leads.map((l) => ({ id: l.id, label: `${l.firma}${l.email ? ` · ${l.email}` : ''}` }));
  const extraSpalten = kampagnenExtraSpalten(id);
  const zaehler = variantenZaehler(id);
  const zusatz = ladeVarianten(id).map((v) => ({ id: v.id, kuerzel: v.kuerzel, betreff: v.betreff, text: v.text, aktiv: v.aktiv, verwendet: zaehler[v.kuerzel] ?? 0 }));
  const postfaecher = ladeAbsender().map((a) => ({ id: a.id, email: a.email, nutzbar: postfachNichtNutzbar(a) === null }));
  const ki = schreibhilfeVerfuegbar();
  const regeln = schreibregelnAktiv();
  const anhaenge = ladeAlleAnhaenge(id).map((a) => ({ id: a.id, followupId: a.followupId, dateiname: a.dateiname, groesse: a.groesse }));
  const anhaengeJeFollowup: Record<number, { id: number; dateiname: string; groesse: number }[]> = {};
  for (const a of anhaenge) if (a.followupId !== null) (anhaengeJeFollowup[a.followupId] ??= []).push({ id: a.id, dateiname: a.dateiname, groesse: a.groesse });
  const followups = ladeFollowups(id).map((f) => ({
    id: f.id,
    waitDays: f.waitDays,
    body: f.body,
    betreff: f.betreff ?? '',
    varianten: ladeFollowupVarianten(f.id).map((v) => ({ kuerzel: v.kuerzel, text: v.text, betreff: v.betreff ?? '', aktiv: v.aktiv })),
  }));

  return (
    <div>
      <p className="mb-1 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">Kampagnen</Link> /{' '}
        <Link href={`/kampagnen/${id}`} className="text-slate-500 hover:underline">{k.name}</Link> / E-Mail-Flow
      </p>
      <h1 className="mb-1 text-xl font-semibold">E-Mail-Flow</h1>
      <p className="mb-6 text-sm text-slate-500">
        Schritt 1 ist die Erstmail{k.mitVideo ? ' mit dem persönlichen Video' : ''}. Danach folgen optional Follow-ups im selben Thread, bis der Lead antwortet.
      </p>

      <Schreibschutz gesperrt={gesperrt} hinweis="Nur Ansicht: Mit Ihrer Rolle können Sie den E-Mail-Flow nicht ändern.">
      <h2 className="mb-3 text-base font-semibold">Schritt 1 · Erstmail (Variante A)</h2>
      <TemplateEditor campaignId={id} subject={k.emailSubjectTemplate} body={k.emailBodyTemplate} postfaecher={postfaecher} leads={leadOptionen} mitVideo={k.mitVideo} extraSpalten={extraSpalten} kiAktiv={ki} schreibregeln={regeln} anhaenge={anhaenge.filter((a) => a.followupId === null)} gesperrt={gesperrt} />

      <h2 className="mb-3 mt-10 text-base font-semibold">A/B-Test</h2>
      <VariantenEditor campaignId={id} initial={zusatz} extraSpalten={extraSpalten} vorschauLeadId={leads[0]?.id ?? null} kiAktiv={ki} schreibregeln={regeln} />

      <h2 className="mb-3 mt-10 text-base font-semibold">Follow-ups</h2>
      <FollowupEditor campaignId={id} initial={followups} leads={leadOptionen} varianten={[STANDARD_VARIANTE, ...zusatz.map((v) => v.kuerzel)]} mitVideo={k.mitVideo} extraSpalten={extraSpalten} kiAktiv={ki} schreibregeln={regeln} anhaenge={anhaengeJeFollowup} gesperrt={gesperrt} />
      </Schreibschutz>
    </div>
  );
}
