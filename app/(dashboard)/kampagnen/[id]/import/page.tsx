import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ImportWizard } from '@/components/ImportWizard';
import { getDb, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const kampagne = getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!kampagne) notFound();

  return (
    <div>
      <p className="mb-1 text-sm">
        <Link href={`/kampagnen/${id}`} className="text-slate-500 hover:underline">
          {kampagne.name}
        </Link>{' '}
        / Import
      </p>
      <h1 className="mb-4 text-xl font-semibold">Leads importieren</h1>
      <ImportWizard campaignId={id} />
    </div>
  );
}
