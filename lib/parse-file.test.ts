import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { guessMapping, summarize, validateRows } from './import';
import { UploadFehler, parseUpload } from './parse-file';

const fix = (n: string) => fs.readFileSync(path.resolve(__dirname, '../test/fixtures', n));
const leer = { existingEmails: new Set<string>(), suppressed: new Set<string>() };

describe('parseUpload', () => {
  it('liest xlsx-Fixture', async () => {
    const { headers, rows } = await parseUpload('leads-test.xlsx', fix('leads-test.xlsx'));
    expect(headers).toEqual(['Name', 'Firma', 'Email']);
    expect(rows).toHaveLength(10);
    expect(summarize(validateRows(rows, guessMapping(headers), leer))).toBe('8 gültig, 1 Duplikat, 1 ungültige E-Mail');
  });
  it('liest csv-Fixture (; und BOM)', async () => {
    const { headers, rows } = await parseUpload('leads-test.csv', fix('leads-test.csv'));
    expect(headers).toEqual(['Name', 'Firma', 'Email']);
    expect(rows).toHaveLength(10);
    expect(rows[1].Firma).toBe('Müller & Söhne GmbH & Co. KG');
  });
  it('erkennt Komma als Trennzeichen', async () => {
    const { headers } = await parseUpload('a.csv', Buffer.from('Name,Firma,Email\nA B,X,a@b.de\n'));
    expect(headers).toEqual(['Name', 'Firma', 'Email']);
  });
  it('lehnt falschen Inhalt und Endung ab', async () => {
    await expect(parseUpload('a.xlsx', Buffer.from('kein zip'))).rejects.toBeInstanceOf(UploadFehler);
    await expect(parseUpload('a.exe', Buffer.from('x'))).rejects.toBeInstanceOf(UploadFehler);
    await expect(parseUpload('a.csv', Buffer.from([0x50, 0x4b, 0, 0]))).rejects.toBeInstanceOf(UploadFehler);
  });
});
