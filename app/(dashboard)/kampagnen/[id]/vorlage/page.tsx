import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { TemplateEditor } from '@/components/TemplateEditor';
import { getDb, schema } from '@/lib/db';
import { senderInfo } from '@/lib/send';

export const dynamic = 'force-dynamic';

export default async function VorlagePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const k = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) notFound();
  const leads = db.select().from(schema.leads).where(eq(schema.leads.campaignId, id)).orderBy(asc(schema.leads.id)).limit(500).all();

  return (
    <div>
      <p className="mb-1 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">Kampagnen</Link> /{' '}
        <Link href={`/kampagnen/${id}`} className="text-slate-500 hover:underline">{k.name}</Link> / Vorlage
      </p>
      <h1 className="mb-4 text-xl font-semibold">Mail-Vorlage</h1>
      <TemplateEditor
        campaignId={id}
        subject={k.emailSubjectTemplate}
        body={k.emailBodyTemplate}
        senderEmail={senderInfo().email}
        leads={leads.map((l) => ({ id: l.id, label: `${l.firma}${l.email ? ` · ${l.email}` : ''}` }))}
      />
    </div>
  );
}
