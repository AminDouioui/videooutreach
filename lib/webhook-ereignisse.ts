// Webhook-Ereignisse und ihre Bezeichnungen (ohne Node-Importe, auch im Browser nutzbar).
// Muss mit WEBHOOK_EREIGNISSE in db/schema.ts übereinstimmen (Test lib/webhook-logik.test.ts).

export const WEBHOOK_EREIGNISSE = ['mail_gesendet', 'antwort', 'bounce', 'abwesenheit', 'abmeldung', 'lead_status', 'video_angesehen', 'video_gestartet', 'termin_klick', 'link_klick'] as const;

export const TEST_EREIGNIS = 'test';

export const EREIGNIS_LABEL: Record<string, string> = {
  mail_gesendet: 'Mail gesendet',
  antwort: 'Antwort erkannt',
  bounce: 'Bounce',
  abwesenheit: 'Abwesenheitsnotiz',
  abmeldung: 'Abmeldung',
  lead_status: 'Lead-Status geändert',
  video_angesehen: 'Video-Seite zum ersten Mal angesehen',
  video_gestartet: 'Video zum ersten Mal gestartet',
  termin_klick: 'Termin-Button geklickt',
  link_klick: 'Link in Mail geklickt',
  test: 'Test',
};
