import { describe, expect, it } from 'vitest';
import { decideSend, randomGapMs, type PlanInput } from './send-plan';

// Mittwoch 15.07.2026 11:00 Berlin
const jetzt = new Date('2026-07-15T09:00:00Z');
const basis: PlanInput = {
  now: jetzt,
  today: '2026-07-15',
  campaign: { status: 'versendet_laufend', dailySendLimit: 10, sendWindowStart: '08:00', sendWindowEnd: '17:00', sendDays: '1,2,3,4,5' },
  globalLimit: 30,
  sentTodayGlobal: 0,
  sentTodayCampaign: 0,
  state: { nextSendAt: null, quotaStoppedDate: null },
};

describe('decideSend', () => {
  it('sendet im Normalfall', () => expect(decideSend(basis)).toEqual({ action: 'send' }));
  it('pausierte Kampagne wartet', () => expect(decideSend({ ...basis, campaign: { ...basis.campaign, status: 'pausiert' } })).toMatchObject({ reason: 'status' }));
  it('Fenster zu (nachts)', () => expect(decideSend({ ...basis, now: new Date('2026-07-15T20:00:00Z') })).toMatchObject({ reason: 'fenster_zu', global: false }));
  it('Fenster zu (Wochenende)', () => expect(decideSend({ ...basis, now: new Date('2026-07-18T09:00:00Z') })).toMatchObject({ reason: 'fenster_zu' }));
  it('vor dem Startdatum wird nicht gesendet', () =>
    expect(decideSend({ ...basis, campaign: { ...basis.campaign, startDatum: '2026-07-16' } })).toMatchObject({ reason: 'vor_start', global: false }));
  it('am Startdatum und danach wird gesendet', () => {
    expect(decideSend({ ...basis, campaign: { ...basis.campaign, startDatum: '2026-07-15' } })).toEqual({ action: 'send' });
    expect(decideSend({ ...basis, campaign: { ...basis.campaign, startDatum: null } })).toEqual({ action: 'send' });
  });
  it('Kampagnenlimit erreicht', () => expect(decideSend({ ...basis, sentTodayCampaign: 10 })).toMatchObject({ reason: 'limit_kampagne', global: false }));
  it('globales Limit erreicht', () => expect(decideSend({ ...basis, sentTodayGlobal: 30 })).toMatchObject({ reason: 'limit_global', global: true }));
  it('Abstand noch nicht verstrichen', () =>
    expect(decideSend({ ...basis, state: { nextSendAt: jetzt.getTime() + 1000, quotaStoppedDate: null } })).toMatchObject({ reason: 'abstand', global: true }));
  it('Abstand verstrichen', () =>
    expect(decideSend({ ...basis, state: { nextSendAt: jetzt.getTime() - 1, quotaStoppedDate: null } })).toEqual({ action: 'send' }));
  it('Quota heute gestoppt, morgen wieder frei', () => {
    expect(decideSend({ ...basis, state: { nextSendAt: null, quotaStoppedDate: '2026-07-15' } })).toMatchObject({ reason: 'quota_gestoppt' });
    expect(decideSend({ ...basis, state: { nextSendAt: null, quotaStoppedDate: '2026-07-14' } })).toEqual({ action: 'send' });
  });
});

describe('randomGapMs', () => {
  it('liegt zwischen min und max', () => {
    expect(randomGapMs(3, 9, () => 0)).toBe(180_000);
    expect(randomGapMs(3, 9, () => 0.999999)).toBeLessThanOrEqual(540_000);
    expect(randomGapMs(9, 3, () => 0.5)).toBe(360_000);
  });
});
