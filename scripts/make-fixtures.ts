// Erzeugt test/fixtures/leads-test.xlsx und .csv (10 Zeilen: 8 gültig, 1 Duplikat, 1 ungültige E-Mail)
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

const zeilen: [string, string, string][] = [
  ['Max Mustermann', 'Musterbau GmbH', 'max.mustermann@musterbau.example'],
  ['Anna Müller', 'Müller & Söhne GmbH & Co. KG', 'a.mueller@mueller-soehne.example'],
  ['Hans-Peter Schröder', 'Straßenbau Schröder AG', 'schroeder@strassenbau.example'],
  ['Katrin Weiß', 'Bäckerei Weiß e.K.', 'k.weiss@baeckerei-weiss.example'],
  ['Jürgen Öztürk', 'Öztürk Metallbau UG (haftungsbeschränkt)', 'oeztuerk@metallbau.example'],
  ['Sabine Köhler', 'Köhler Logistik GmbH', 'sabine.koehler@koehler-logistik.example'],
  ['Thomas Groß', 'Groß Maschinenbau OHG', 'thomas.gross@gross-maschinenbau.example'],
  ['Eva Lange', 'Lange Elektrotechnik GbR', 'e.lange@lange-elektro.example'],
  // Duplikat (E-Mail wie Zeile 1, andere Schreibweise)
  ['Max Mustermann', 'Musterbau Nord GmbH', 'Max.Mustermann@musterbau.example'],
  // Ungültige E-Mail
  ['Lars Bauer', 'Bauer Fensterbau GmbH', 'lars.bauer-at-fensterbau.example'],
];

async function main() {
  const dir = path.resolve(__dirname, '../test/fixtures');
  fs.mkdirSync(dir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.addRow(['Name', 'Firma', 'Email']);
  zeilen.forEach((z) => ws.addRow(z));
  await wb.xlsx.writeFile(path.join(dir, 'leads-test.xlsx'));

  const csv = ['Name;Firma;Email', ...zeilen.map((z) => z.join(';'))].join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(dir, 'leads-test.csv'), '﻿' + csv, 'utf8');
  console.log('Fixtures geschrieben nach', dir);
}

main();
