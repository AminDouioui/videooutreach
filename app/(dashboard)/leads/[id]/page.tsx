import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge, LeadStatusBadge } from '@/components/Badge';
import { LeadStatusSelect } from '@/components/LeadStatusSelect';
import { CopyButton } from '@/components/CopyButton';
import { LeadActions, MailVorschau, NotizFeld } from '@/components/LeadDetailPanel';
import { ladeAbsenderMitId } from '@/lib/absender';
import { getDb, schema } from '@/lib/db';
import { gmailThreadUrl } from '@/lib/lead-status';
import { setzeAntwortGelesen } from '@/lib/lead-status-db';
import { leadPageUrl, thumbnailUrl, videoUrl } from '@/lib/media';

export const dynamic = 'force-dynamic';

const EVENT_LABEL: Record<string, string> = {
  page_view: 'Seite aufgerufen',
  play: 'Video gestartet',
  progress_25: '25 % angeschaut',
  progress_50: '50 % angeschaut',
  progress_75: '75 % angeschaut',
  progress_100: 'Video komplett angeschaut',
  cta_click: 'Termin-Link geklickt',
  email_open: 'E-Mail geöffnet',
  unsubscribe: 'Abgemeldet',
};

const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'medium' });

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) notFound();
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) notFound();
  const events = db.select().from(schema.events).where(eq(schema.events.leadId, id)).orderBy(asc(schema.events.createdAt), asc(schema.events.id)).all();

  // Öffnen des Lead-Details markiert eine Antwort als gelesen
  if (lead.flowStopp === 'beantwortet' && !lead.antwortGelesen) setzeAntwortGelesen(lead.id, true);

  const postfach = lead.absenderId !== null ? ladeAbsenderMitId(lead.absenderId) : null;
  const name = [lead.anrede, lead.vorname, lead.nachname].filter(Boolean).join(' ');
  const link = leadPageUrl(lead.slug);
  const fertig = lead.renderStatus === 'fertig';

  return (
    <div>
      <p className="mb-1 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">
          Kampagnen
        </Link>{' '}
        /{' '}
        <Link href={`/kampagnen/${kampagne.id}`} className="text-slate-500 hover:underline">
          {kampagne.name}
        </Link>{' '}
        / {lead.firma}
      </p>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold">
            {lead.firma} <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-sm font-medium text-indigo-800">Score {lead.score}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {name || 'Kein Ansprechpartner'} · {lead.email}
            {lead.position ? ` · ${lead.position}` : ''}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge status={lead.renderStatus} />
            <Badge status={lead.sendStatus} />
            <LeadStatusBadge status={lead.leadStatus} />
            {lead.variante && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700" title="Variante der Erstmail">Variante {lead.variante}</span>}
            {lead.flowStopp && <Badge status={lead.flowStopp} />}
            {lead.unsubscribed && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Abgemeldet</span>}
            <a href={`/v/${lead.slug}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-indigo-600 hover:underline">
              {link}
            </a>
            <CopyButton text={link} label="Link kopieren" />
          </p>
          {lead.renderError && <p className="mt-2 text-sm text-red-700">Render-Fehler: {lead.renderError}</p>}
          {lead.sendError && <p className="mt-2 text-sm text-red-700">Versand-Fehler: {lead.sendError}</p>}
        </div>
        <LeadActions leadId={lead.id} campaignId={kampagne.id} sendStatus={lead.sendStatus} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Video</h2>
          {fertig ? (
            <>
              <video controls playsInline preload="metadata" poster={thumbnailUrl(lead.slug, lead.renderedAt)} src={videoUrl(lead.slug, lead.renderedAt)} className="aspect-video w-full rounded-md bg-black" />
              <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Vorschaubild</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbnailUrl(lead.slug, lead.renderedAt)} alt={`Vorschaubild für ${lead.firma}`} className="w-64 rounded-md border border-slate-200" />
            </>
          ) : (
            <p className="text-sm text-slate-500">Video noch nicht gerendert.</p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Aktivität</h2>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">Noch keine Aktivität.</p>
          ) : (
            <ol className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {events.map((e) => (
                <li key={e.id} className={`flex items-center gap-3 text-sm ${e.isBot ? 'text-slate-400' : ''}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.isBot ? 'bg-slate-300' : e.type === 'cta_click' ? 'bg-green-500' : 'bg-indigo-500'}`} />
                  <span className="w-44 shrink-0 tabular-nums text-xs">{zeit.format(e.createdAt)}</span>
                  <span className={e.isBot ? '' : 'font-medium'}>{EVENT_LABEL[e.type] ?? e.type}</span>
                  {e.isBot && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Bot</span>}
                  {e.type === 'email_open' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">unzuverlässig</span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Lead-Status &amp; Antwort</h2>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <LeadStatusSelect leadId={lead.id} status={lead.leadStatus} />
              {lead.leadStatusAt && <span className="text-xs text-slate-500">gesetzt am {zeit.format(lead.leadStatusAt)}</span>}
            </div>
            <p className="text-xs text-slate-500">Nicht interessiert, falscher Ansprechpartner, Termin gebucht, Gewonnen und Verloren beenden den Flow (keine Follow-ups mehr).</p>
            <p>
              <span className="text-slate-500">Erstmail-Variante:</span> {lead.variante ?? '–'}
            </p>
            <p>
              <span className="text-slate-500">Absender-Postfach:</span> {postfach ? postfach.email : lead.sendStatus === 'gesendet' ? 'nicht zugeordnet (Altbestand)' : '–'}
              {postfach && (!postfach.aktiv || postfach.fehler || !postfach.refreshTokenEnc) && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">pausiert/getrennt – Follow-ups warten</span>}
            </p>
            <p>
              <span className="text-slate-500">Antwort:</span>{' '}
              {lead.flowStopp === 'beantwortet' ? (lead.antwortAt ?? lead.flowStoppAt ? `erkannt am ${zeit.format((lead.antwortAt ?? lead.flowStoppAt)!)}` : 'erkannt') : lead.flowStopp === 'firma_beantwortet' ? 'Kollege aus derselben Firma hat geantwortet' : 'keine'}
            </p>
            {lead.gmailThreadId && (
              <a href={gmailThreadUrl(lead.gmailThreadId)} target="_blank" rel="noopener noreferrer" className="inline-block rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                In Gmail öffnen
              </a>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Mail-Vorschau</h2>
          <MailVorschau leadId={lead.id} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Notizen</h2>
          <NotizFeld leadId={lead.id} initial={lead.notizen ?? ''} />
        </section>
      </div>
    </div>
  );
}
