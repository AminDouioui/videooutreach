import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashIp } from './crypto';
import { createSessionToken, isPublicPath, verifySessionToken } from './auth';

const key = Buffer.alloc(32, 7);

describe('crypto', () => {
  it('verschlüsselt und entschlüsselt', () => {
    const c = encrypt('geheim äöü', key);
    expect(c).not.toContain('geheim');
    expect(decrypt(c, key)).toBe('geheim äöü');
  });
  it('manipulierter Wert schlägt fehl', () => {
    const buf = Buffer.from(encrypt('x', key), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString('base64'), key)).toThrow();
  });
  it('hashIp ist deterministisch und gesalzen', () => {
    expect(hashIp('1.2.3.4', 'a')).toBe(hashIp('1.2.3.4', 'a'));
    expect(hashIp('1.2.3.4', 'a')).not.toBe(hashIp('1.2.3.4', 'b'));
  });
});

describe('auth', () => {
  const secret = 'x'.repeat(32);
  it('gültiges Token', async () => expect(await verifySessionToken(await createSessionToken(secret), secret)).toBe(true));
  it('abgelaufen / falsches Secret / Müll', async () => {
    const t = await createSessionToken(secret, 0);
    expect(await verifySessionToken(t, secret)).toBe(false);
    expect(await verifySessionToken(await createSessionToken(secret), 'y'.repeat(32))).toBe(false);
    expect(await verifySessionToken('abc', secret)).toBe(false);
    expect(await verifySessionToken(undefined, secret)).toBe(false);
  });
  it('öffentliche Pfade', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/v/abc')).toBe(true);
    expect(isPublicPath('/api/t')).toBe(true);
    expect(isPublicPath('/api/tx')).toBe(false);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/api/campaigns')).toBe(false);
  });
});
