import { NextResponse, type NextRequest } from 'next/server';
import { guessMapping } from '@/lib/import';
import { MAX_UPLOAD_BYTES, UploadFehler, parseUpload } from '@/lib/parse-file';
import { fehler } from '@/lib/request';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const laenge = Number(req.headers.get('content-length') ?? 0);
  if (laenge > MAX_UPLOAD_BYTES + 100 * 1024) return fehler('Die Datei ist größer als 5 MB.', 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fehler('Ungültiger Upload');
  }
  const datei = form.get('file');
  if (!(datei instanceof File)) return fehler('Keine Datei übermittelt');
  if (datei.size > MAX_UPLOAD_BYTES) return fehler('Die Datei ist größer als 5 MB.', 413);

  try {
    const { headers, rows } = await parseUpload(datei.name, Buffer.from(await datei.arrayBuffer()));
    if (rows.length === 0) return fehler('Die Datei enthält keine Datenzeilen.');
    return NextResponse.json({ headers, rows, guessedMapping: guessMapping(headers) });
  } catch (e) {
    if (e instanceof UploadFehler) return fehler(e.message);
    console.error('Upload-Parsing fehlgeschlagen', e);
    return fehler('Die Datei konnte nicht verarbeitet werden.', 500);
  }
}
