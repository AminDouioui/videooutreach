import { and, eq, sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, renderStill, selectComposition, type HeadlessBrowser } from '@remotion/renderer';
import { getDb, schema } from '../lib/db';
import { getEnv } from '../lib/env';
import { mediaDir, thumbnailPath, videoPath } from '../lib/media';
import { schliesseKampagneAb } from '../lib/render-queue';
import { outreachPropsSchema, type OutreachProps } from '../remotion/schema';

// Render-Schleife des Workers: Remotion einmal bündeln, dann Leads aus der Warteschlange rendern.

const POLL_MS = 3000;
const ROOT = process.cwd();

let serveUrl: string | null = null;
let browser: HeadlessBrowser | null = null;
const aktiv = new Map<number, Promise<void>>();
let laeuft = true;

function browserExecutable(): string | null {
  return getEnv().REMOTION_BROWSER_EXECUTABLE ?? null;
}

async function holeBrowser(): Promise<HeadlessBrowser> {
  if (browser) return browser;
  browser = await openBrowser('chrome', { browserExecutable: browserExecutable(), chromiumOptions: { gl: 'swangle' } });
  return browser;
}

/** Remotion-Projekt bündeln (einmal beim Start). */
export async function bundleRemotion(): Promise<void> {
  console.log('[render] Bündele Remotion-Projekt …');
  const t = Date.now();
  serveUrl = await bundle({
    entryPoint: path.join(ROOT, 'remotion/index.ts'),
    publicDir: path.join(ROOT, 'remotion/public'),
  });
  console.log(`[render] Bundle fertig (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}

/** Recovery: beim Start hängengebliebene Jobs zurück in die Warteschlange. */
export function recoverRenderJobs(): void {
  const db = getDb();
  const res = db
    .update(schema.leads)
    .set({ renderStatus: 'wartet', renderRequested: true })
    .where(eq(schema.leads.renderStatus, 'rendert'))
    .run();
  if (res.changes > 0) console.log(`[render] Recovery: ${res.changes} hängende Jobs wieder eingereiht`);
  // Kampagnen mit offenen Jobs müssen den Status 'rendert' haben
  db.run(sql`update campaigns set status = 'rendert' where status in ('entwurf','bereit') and id in (select campaign_id from leads where render_status = 'wartet' and render_requested = 1)`);
}

function kuerzen(e: unknown): string {
  const text = e instanceof Error ? `${e.message}` : String(e);
  return text.slice(0, 1000);
}

async function renderLead(leadId: number): Promise<void> {
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead || !serveUrl) return;
  const start = Date.now();
  const tmpVideo = path.join(mediaDir(), `${lead.slug}.rendering.mp4`);
  const tmpThumb = path.join(mediaDir(), `${lead.slug}.rendering.jpg`);
  try {
    fs.mkdirSync(mediaDir(), { recursive: true });
    const inputProps: OutreachProps = outreachPropsSchema.parse({
      firma: lead.firma,
      anrede: lead.anrede ?? '',
      vorname: lead.vorname ?? '',
      nachname: lead.nachname ?? '',
    });
    const puppeteerInstance = await holeBrowser();
    const common = { serveUrl, puppeteerInstance, browserExecutable: browserExecutable() };

    const videoComp = await selectComposition({ ...common, id: 'OutreachVideo', inputProps });
    await renderMedia({
      ...common,
      composition: videoComp,
      codec: 'h264',
      crf: 28,
      audioCodec: 'aac',
      imageFormat: 'jpeg',
      inputProps,
      outputLocation: tmpVideo,
      overwrite: true,
      concurrency: 2,
    });

    const thumbComp = await selectComposition({ ...common, id: 'OutreachThumbnail', inputProps });
    await renderStill({
      ...common,
      composition: thumbComp,
      inputProps,
      imageFormat: 'jpeg',
      jpegQuality: 85,
      output: tmpThumb,
      overwrite: true,
    });

    // Atomar an den Zielort verschieben
    fs.renameSync(tmpVideo, videoPath(lead.slug));
    fs.renameSync(tmpThumb, thumbnailPath(lead.slug));
    db.update(schema.leads)
      .set({
        renderStatus: 'fertig',
        renderError: null,
        renderRequested: false,
        videoPath: videoPath(lead.slug),
        thumbnailPath: thumbnailPath(lead.slug),
        renderedAt: new Date(),
      })
      .where(eq(schema.leads.id, leadId))
      .run();
    console.log(`[render] ${lead.slug} fertig in ${((Date.now() - start) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.error(`[render] ${lead.slug} fehlgeschlagen:`, e);
    for (const p of [tmpVideo, tmpThumb]) fs.rmSync(p, { force: true });
    // Browser nach Fehlern verwerfen, beim nächsten Job wird ein frischer geöffnet
    const kaputt = browser;
    browser = null;
    kaputt?.close({ silent: true }).catch(() => undefined);
    db.update(schema.leads)
      .set({ renderStatus: 'fehler', renderError: kuerzen(e), renderRequested: false })
      .where(eq(schema.leads.id, leadId))
      .run();
  } finally {
    try {
      schliesseKampagneAb(lead.campaignId);
    } catch (e) {
      console.error('[render] Kampagnenstatus konnte nicht aktualisiert werden:', e);
    }
  }
}

/** Ein Durchlauf: freie Plätze mit wartenden, angeforderten Leads füllen. */
function tick(): void {
  if (!laeuft || !serveUrl) return;
  const frei = getEnv().RENDER_CONCURRENCY - aktiv.size;
  if (frei <= 0) return;
  const db = getDb();
  const naechste = db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(and(eq(schema.leads.renderStatus, 'wartet'), eq(schema.leads.renderRequested, true)))
    .orderBy(schema.leads.id)
    .limit(frei)
    .all();
  for (const { id } of naechste) {
    if (aktiv.has(id)) continue;
    db.update(schema.leads).set({ renderStatus: 'rendert' }).where(eq(schema.leads.id, id)).run();
    const job = renderLead(id)
      .catch((e) => console.error('[render] Unerwarteter Fehler:', e))
      .finally(() => aktiv.delete(id));
    aktiv.set(id, job);
  }
}

/** Startet die Render-Schleife (Polling alle 3 s). Liefert eine Stop-Funktion, die auf laufende Jobs wartet. */
export function startRenderLoop(): () => Promise<void> {
  const timer = setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.error('[render] Fehler in der Render-Schleife:', e);
    }
  }, POLL_MS);
  return async () => {
    laeuft = false;
    clearInterval(timer);
    await Promise.allSettled([...aktiv.values()]);
    await browser?.close({ silent: true }).catch(() => undefined);
  };
}
