import fs from 'fs';
import path from 'path';
import { getEnv } from './env';

// Zentrale Pfad- und URL-Logik für gerenderte Medien (Video + Vorschaubild)

/** Absoluter Pfad des Medienverzeichnisses (`${DATA_DIR}/media`). */
export function mediaDir(): string {
  return path.join(path.resolve(getEnv().DATA_DIR), 'media');
}

export function videoPath(slug: string): string {
  return path.join(mediaDir(), `${slug}.mp4`);
}

export function thumbnailPath(slug: string): string {
  return path.join(mediaDir(), `${slug}.jpg`);
}

/** Cache-Buster: beim Neu-Rendern ändert sich die URL. */
function version(renderedAt?: Date | null): string {
  return renderedAt ? `?v=${renderedAt.getTime()}` : '';
}

/** Relative URL (für die eigene Video-Seite). */
export function videoUrl(slug: string, renderedAt?: Date | null): string {
  return `/media/${slug}.mp4${version(renderedAt)}`;
}

export function thumbnailUrl(slug: string, renderedAt?: Date | null): string {
  return `/media/${slug}.jpg${version(renderedAt)}`;
}

/** Absolute URLs (für E-Mails). */
export function absoluteUrl(relative: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, '')}${relative}`;
}

/** Öffentlicher Link zur Video-Seite eines Leads. */
export function leadPageUrl(slug: string): string {
  return absoluteUrl(`/v/${slug}`);
}

/** Löscht Video und Vorschaubild eines Leads (fehlende Dateien werden ignoriert). */
export function deleteMedia(slug: string): void {
  for (const p of [videoPath(slug), thumbnailPath(slug)]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // Datei existiert nicht – ok
    }
  }
}
