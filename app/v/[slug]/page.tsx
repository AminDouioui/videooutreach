import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { VideoPlayer } from '@/components/VideoPlayer';
import { getDb, schema } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { thumbnailUrl, videoUrl } from '@/lib/media';
import { begruessung } from '@/lib/name';
import { getSetting, legalUrls } from '@/lib/settings';

export const dynamic = 'force-dynamic';

function ladeLead(slug: string) {
  return getDb()
    .select({ lead: schema.leads, ctaUrl: schema.campaigns.ctaUrl })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(eq(schema.leads.slug, slug))
    .get();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const row = ladeLead(slug);
  return {
    title: row ? `Ein Video für ${row.lead.firma}` : 'Nicht gefunden',
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function VideoSeite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = ladeLead(slug);
  if (!row) notFound();
  const { lead, ctaUrl } = row;

  const absender = getEnv().SENDER_EMAIL || getSetting('gmail_email');
  const betreff = encodeURIComponent(`Ihr Video für ${lead.firma}`);
  const mailto = absender ? `mailto:${absender}?subject=${betreff}` : null;
  const recht = legalUrls();
  const bereit = lead.renderStatus === 'fertig';

  return (
    <div className="flex min-h-screen flex-col bg-white text-[#0a0a0a]">
      <header className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6 sm:pt-8">
        <span className="text-xl font-bold tracking-tight">
          Prozessia<span className="text-[#7b3aec]">.</span>
        </span>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {bereit ? (
          <>
            <h1 className="text-balance text-3xl font-bold leading-[1.15] tracking-tight sm:text-5xl">
              {begruessung(lead)}, ein Video für <span className="text-[#7b3aec]">{lead.firma}</span>
            </h1>
            <p className="mb-8 mt-4 max-w-2xl text-base text-neutral-600 sm:text-lg">
              Ich habe Ihnen ein kurzes, persönliches Video vorbereitet – in knapp einer Minute sehen Sie, wie wir Ihren Einkauf entlasten können.
            </p>
            <VideoPlayer
              slug={lead.slug}
              videoSrc={videoUrl(lead.slug, lead.renderedAt)}
              posterSrc={thumbnailUrl(lead.slug, lead.renderedAt)}
              ctaUrl={ctaUrl}
              mailto={mailto}
            />
          </>
        ) : (
          <div className="py-20 text-center">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Video wird vorbereitet</h1>
            <p className="mt-3 text-neutral-600">Ihr persönliches Video ist in Kürze verfügbar. Bitte versuchen Sie es später noch einmal.</p>
          </div>
        )}
      </main>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-neutral-500 sm:px-6">
          <span>
            Prozessia<span className="text-[#7b3aec]">.</span>
          </span>
          {recht.impressum && (
            <a href={recht.impressum} className="hover:text-[#0a0a0a] hover:underline" target="_blank" rel="noopener noreferrer">
              Impressum
            </a>
          )}
          {recht.datenschutz && (
            <a href={recht.datenschutz} className="hover:text-[#0a0a0a] hover:underline" target="_blank" rel="noopener noreferrer">
              Datenschutz
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}
