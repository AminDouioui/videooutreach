// Legt die Kampagne „Sechs-Mails-Sequenz“ (siehe lib/kampagne-sechs-mails.ts) als Entwurf an.
// Aufruf: npm run kampagne:sechs-mails -- [Termin-Link] [Name]
import { speichereFollowups } from '../lib/campaigns';
import { getDb, schema } from '../lib/db';
import { OFFENE_MARKER, SECHS_MAILS_ERSTMAIL, SECHS_MAILS_FOLLOWUPS, SECHS_MAILS_NAME } from '../lib/kampagne-sechs-mails';

const ctaUrl = process.argv[2] ?? process.env.DEFAULT_CTA_URL ?? 'https://calendly.com/sebastian-spuhler/30min';
const name = process.argv[3] ?? SECHS_MAILS_NAME;

const [k] = getDb()
  .insert(schema.campaigns)
  .values({
    name,
    ctaUrl,
    mitVideo: true,
    status: 'entwurf',
    emailSubjectTemplate: SECHS_MAILS_ERSTMAIL.betreff,
    emailBodyTemplate: SECHS_MAILS_ERSTMAIL.text,
    // Wenige Mails pro Tag, Di bis Do: für kalte Adressen am sichersten
    dailySendLimit: 30,
    sendDays: '2,3,4',
  })
  .returning()
  .all();
speichereFollowups(k.id, SECHS_MAILS_FOLLOWUPS);

const offen = SECHS_MAILS_FOLLOWUPS.flatMap((f) => f.body.match(OFFENE_MARKER) ?? []);
console.log(`Kampagne ${k.id} „${name}“ angelegt (Entwurf, 1 Erstmail + ${SECHS_MAILS_FOLLOWUPS.length} Follow-ups).`);
if (offen.length) console.log(`Vor dem Start in Mail 3 ersetzen: ${offen.join(' ')}`);
