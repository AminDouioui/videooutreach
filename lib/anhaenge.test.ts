import { describe, expect, it } from 'vitest';
import { dateinameFuerPlatte, endung, formatGroesse, MAX_ANZAHL, MAX_DATEI_BYTES, MAX_GESAMT_BYTES, pruefeDatei, pruefeGrenzen, sanitiereDateiname } from './anhaenge';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
const office = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(10), Buffer.from('[Content_Types].xml'), Buffer.alloc(32)]);
const zipOhneOffice = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(10), Buffer.from('foo.txt'), Buffer.alloc(32)]);

describe('Dateinamen', () => {
  it('entfernt Pfade, Steuerzeichen und Anführungszeichen, behält Umlaute', () => {
    expect(sanitiereDateiname('../../etc/passwd')).toBe('passwd');
    expect(sanitiereDateiname('C:\\Users\\x\\Übersicht Größe.pdf')).toBe('Übersicht Größe.pdf');
    expect(sanitiereDateiname('a"b\r\nc<d>.pdf')).toBe('a b c d .pdf');
    expect(sanitiereDateiname('..hidden.txt')).toBe('hidden.txt');
    expect(sanitiereDateiname('')).toBe('anhang');
    expect(sanitiereDateiname('///')).toBe('anhang');
  });
  it('kürzt lange Namen und behält die Endung', () => {
    const n = sanitiereDateiname(`${'a'.repeat(300)}.pdf`);
    expect(n.length).toBe(120);
    expect(n.endsWith('.pdf')).toBe(true);
  });
  it('Plattenname ist ASCII und ohne Pfadzeichen', () => {
    expect(dateinameFuerPlatte('Übersicht Größe (final).PDF'.toLowerCase())).toBe('ubersicht_grosse_final.pdf');
    expect(dateinameFuerPlatte('日本語.pdf')).toBe('datei.pdf');
    expect(dateinameFuerPlatte('a/b\\c.pdf')).not.toMatch(/[\\/]/);
  });
  it('endung / formatGroesse', () => {
    expect(endung('a.PDF')).toBe('pdf');
    expect(endung('.pdf')).toBe('');
    expect(endung('ohne')).toBe('');
    expect(formatGroesse(500)).toBe('500 B');
    expect(formatGroesse(2048)).toBe('2 KB');
    expect(formatGroesse(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('pruefeDatei', () => {
  it('akzeptiert gültige Dateien aller Typen mit passendem MIME-Typ', () => {
    const faelle: [string, Buffer, string][] = [
      ['a.pdf', pdf, 'application/pdf'],
      ['a.PNG', png, 'image/png'],
      ['a.jpg', jpg, 'image/jpeg'],
      ['a.jpeg', jpg, 'image/jpeg'],
      ['a.doc', ole, 'application/msword'],
      ['a.xls', ole, 'application/vnd.ms-excel'],
      ['a.ppt', ole, 'application/vnd.ms-powerpoint'],
      ['a.docx', office, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['a.xlsx', office, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['a.pptx', office, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      ['a.csv', Buffer.from('a;b\n1;2\n'), 'text/csv'],
      ['a.txt', Buffer.from('Grüße'), 'text/plain'],
    ];
    for (const [name, inhalt, mime] of faelle) {
      const r = pruefeDatei(name, inhalt);
      expect(r, name).toEqual({ ok: true, dateiname: name, mime });
    }
  });
  it('lehnt nicht erlaubte Endungen ab', () => {
    for (const n of ['virus.exe', 'x.js', 'x.html', 'x.svg', 'x.zip', 'x.bat', 'x.php', 'ohne', 'x.pdf.exe']) {
      const r = pruefeDatei(n, pdf);
      expect(r.ok, n).toBe(false);
    }
    const r = pruefeDatei('virus.exe', Buffer.from('MZ'));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.fehler).toContain('nicht erlaubt');
  });
  it('prüft die Dateikennung (Magic Bytes) passend zur Endung', () => {
    expect(pruefeDatei('x.pdf', Buffer.from('MZ\x90\x00exe-programm')).ok).toBe(false);
    expect(pruefeDatei('x.pdf', png).ok).toBe(false);
    expect(pruefeDatei('x.png', jpg).ok).toBe(false);
    expect(pruefeDatei('x.jpg', png).ok).toBe(false);
    expect(pruefeDatei('x.docx', pdf).ok).toBe(false);
    expect(pruefeDatei('x.docx', zipOhneOffice).ok).toBe(false);
    expect(pruefeDatei('x.xls', office).ok).toBe(false);
    expect(pruefeDatei('x.txt', Buffer.from([0x4d, 0x5a, 0x00, 0x01])).ok).toBe(false);
  });
  it('lehnt leere und zu große Dateien ab', () => {
    expect(pruefeDatei('x.pdf', Buffer.alloc(0))).toMatchObject({ ok: false });
    const gross = Buffer.concat([pdf, Buffer.alloc(MAX_DATEI_BYTES)]);
    const r = pruefeDatei('x.pdf', gross);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.fehler).toContain('zu groß');
    // genau am Limit ist erlaubt
    const genau = Buffer.concat([pdf, Buffer.alloc(MAX_DATEI_BYTES - pdf.length)]);
    expect(pruefeDatei('x.pdf', genau).ok).toBe(true);
  });
  it('bereinigt den Namen im Ergebnis', () => {
    expect(pruefeDatei('../Übersicht.pdf', pdf)).toMatchObject({ ok: true, dateiname: 'Übersicht.pdf' });
  });
});

describe('pruefeGrenzen', () => {
  it('Anzahl: höchstens 5 je Mail', () => {
    const vier = Array.from({ length: MAX_ANZAHL - 1 }, () => ({ groesse: 10 }));
    expect(pruefeGrenzen(vier, 10)).toBeNull();
    expect(pruefeGrenzen([...vier, { groesse: 10 }], 10)).toContain('Höchstens 5');
  });
  it('Summe: höchstens 15 MB je Mail', () => {
    const mb = 1024 * 1024;
    expect(pruefeGrenzen([{ groesse: 10 * mb }], 5 * mb)).toBeNull();
    expect(pruefeGrenzen([{ groesse: 10 * mb }], 5 * mb + 1)).toContain('zusammen');
    expect(pruefeGrenzen([{ groesse: MAX_GESAMT_BYTES }], 1)).not.toBeNull();
  });
});
