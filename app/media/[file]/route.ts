import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATEI_REGEX = /^[a-z0-9-]+\.(mp4|jpg)$/;

/** NUR Fallback für die lokale Entwicklung; in Produktion liefert der Reverse Proxy /media/ direkt. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!DATEI_REGEX.test(file)) return new Response('Nicht gefunden', { status: 404 });

  const pfad = path.join(path.resolve(getEnv().DATA_DIR), 'media', file);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(pfad);
    if (!stat.isFile()) throw new Error();
  } catch {
    return new Response('Nicht gefunden', { status: 404 });
  }

  const typ = file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
  const basis: Record<string, string> = {
    'Content-Type': typ,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start: number;
    let end: number;
    if (m && (m[1] || m[2])) {
      if (m[1] === '') {
        // Suffix-Range: letzte N Bytes
        start = Math.max(stat.size - Number(m[2]), 0);
        end = stat.size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
      }
    } else {
      start = NaN;
      end = NaN;
    }
    if (Number.isNaN(start) || start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { ...basis, 'Content-Range': `bytes */${stat.size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(pfad, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...basis, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }

  const stream = Readable.toWeb(fs.createReadStream(pfad)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...basis, 'Content-Length': String(stat.size) } });
}
