import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { Row } from './import';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;

export class UploadFehler extends Error {}

export type ParsedFile = { headers: string[]; rows: Row[] };

/** Zellwert (ExcelJS) in Text umwandeln */
function zelleZuText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('').trim();
    if ('result' in o && o.result !== undefined) return zelleZuText(o.result as ExcelJS.CellValue);
    if (typeof o.text === 'string') return o.text.trim(); // Hyperlink (z. B. mailto:)
    if (typeof o.hyperlink === 'string') return o.hyperlink.replace(/^mailto:/i, '').trim();
  }
  return '';
}

/** Kopfzeilen bereinigen: leere Namen und doppelte Namen eindeutig machen */
function eindeutigeHeader(roh: string[]): string[] {
  const benutzt = new Map<string, number>();
  return roh.map((h, i) => {
    const basis = h.trim() || `Spalte ${i + 1}`;
    const n = benutzt.get(basis) ?? 0;
    benutzt.set(basis, n + 1);
    return n === 0 ? basis : `${basis} (${n + 1})`;
  });
}

function zeilenBauen(headers: string[], daten: string[][]): Row[] {
  const rows: Row[] = [];
  for (const zeile of daten) {
    if (zeile.every((c) => !c)) continue; // leere Zeilen überspringen
    const row: Row = {};
    headers.forEach((h, i) => {
      row[h] = zeile[i] ?? '';
    });
    rows.push(row);
  }
  if (rows.length > MAX_ROWS) throw new UploadFehler(`Die Datei enthält mehr als ${MAX_ROWS} Zeilen.`);
  return rows;
}

async function parseXlsx(buf: Buffer): Promise<ParsedFile> {
  // xlsx ist ein ZIP-Archiv: Magic Bytes „PK“ prüfen
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new UploadFehler('Die Datei ist keine gültige Excel-Datei (.xlsx).');
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new UploadFehler('Die Excel-Datei konnte nicht gelesen werden.');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount === 0) throw new UploadFehler('Die Excel-Datei enthält kein Tabellenblatt mit Daten.');

  const spalten = Math.max(ws.columnCount, 1);
  const zeilen: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const werte: string[] = [];
    for (let c = 1; c <= spalten; c++) werte.push(zelleZuText(row.getCell(c).value));
    zeilen.push(werte);
  });
  if (zeilen.length === 0) throw new UploadFehler('Die Datei enthält keine Daten.');
  const headers = eindeutigeHeader(zeilen[0]);
  return { headers, rows: zeilenBauen(headers, zeilen.slice(1)) };
}

function parseCsv(buf: Buffer): ParsedFile {
  if (buf.includes(0)) throw new UploadFehler('Die Datei ist keine gültige CSV-Textdatei.');
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM entfernen
  // Ungültiges UTF-8 (Ersatzzeichen) → vermutlich Windows-1252
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf).replace(/^﻿/, '');

  const ersteZeile = text.split(/\r?\n/, 1)[0] ?? '';
  const zaehle = (z: string) => ersteZeile.split(z).length - 1;
  const kandidaten: [string, number][] = [
    [';', zaehle(';')],
    [',', zaehle(',')],
    ['\t', zaehle('\t')],
  ];
  const delimiter = kandidaten.sort((a, b) => b[1] - a[1])[0][0];

  const res = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' });
  const zeilen = res.data.map((r) => r.map((c) => (c ?? '').trim()));
  if (zeilen.length === 0) throw new UploadFehler('Die Datei enthält keine Daten.');
  const headers = eindeutigeHeader(zeilen[0]);
  return { headers, rows: zeilenBauen(headers, zeilen.slice(1)) };
}

/** Parst eine hochgeladene .xlsx- oder .csv-Datei; prüft Endung und Inhalt. */
export async function parseUpload(dateiname: string, buf: Buffer): Promise<ParsedFile> {
  if (buf.length === 0) throw new UploadFehler('Die Datei ist leer.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new UploadFehler('Die Datei ist größer als 5 MB.');
  const name = dateiname.toLowerCase();
  if (name.endsWith('.xlsx')) return parseXlsx(buf);
  if (name.endsWith('.csv')) return parseCsv(buf);
  throw new UploadFehler('Nur .xlsx- und .csv-Dateien sind erlaubt.');
}
