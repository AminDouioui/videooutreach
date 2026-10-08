import { describe, expect, it } from 'vitest';
import { classifyGmailError } from './gmail-error';

describe('classifyGmailError', () => {
  it('429 → quota', () => expect(classifyGmailError({ code: 429, message: 'Too many' }).art).toBe('quota'));
  it('rateLimitExceeded in 403 → quota', () =>
    expect(classifyGmailError({ code: 403, message: 'x', errors: [{ reason: 'rateLimitExceeded' }] }).art).toBe('quota'));
  it('dailyLimitExceeded via response.data → quota', () =>
    expect(classifyGmailError({ response: { status: 403, data: { error: { message: 'm', errors: [{ reason: 'dailyLimitExceeded' }] } } } }).art).toBe('quota'));
  it('400 Invalid To header → ungültiger Empfänger', () =>
    expect(classifyGmailError({ code: 400, message: 'Invalid To header' }).art).toBe('ungueltiger_empfaenger'));
  it('invalid_grant → auth', () => expect(classifyGmailError(new Error('invalid_grant')).art).toBe('auth'));
  it('401 → auth', () => expect(classifyGmailError({ code: 401, message: 'Login Required' }).art).toBe('auth'));
  it('sonst → sonstig', () => expect(classifyGmailError(new Error('ECONNRESET')).art).toBe('sonstig'));
});
