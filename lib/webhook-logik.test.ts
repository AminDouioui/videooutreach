import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EREIGNISSE as SCHEMA_EREIGNISSE } from '../db/schema';
import { backoffMs, BACKOFF_MS, istPrivateIp, neuesGeheimnis, pruefeWebhookZiel, signiere, WEBHOOK_EREIGNISSE } from './webhook-logik';

describe('Ereignisse', () => {
  it('stimmen mit dem Schema überein', () => expect([...WEBHOOK_EREIGNISSE]).toEqual([...SCHEMA_EREIGNISSE]));
});

describe('signiere', () => {
  it('liefert sha256=<HMAC-Hex> über den Body', () => {
    const erwartet = createHmac('sha256', 'geheim').update('{"a":1}').digest('hex');
    expect(signiere('geheim', '{"a":1}')).toBe(`sha256=${erwartet}`);
  });
  it('hängt von Geheimnis und Body ab', () => {
    expect(signiere('a', 'x')).not.toBe(signiere('b', 'x'));
    expect(signiere('a', 'x')).not.toBe(signiere('a', 'y'));
  });
  it('Geheimnisse sind zufällig', () => {
    expect(neuesGeheimnis()).not.toBe(neuesGeheimnis());
    expect(neuesGeheimnis().length).toBeGreaterThan(40);
  });
});

describe('backoffMs', () => {
  it('1 min, 5 min, 30 min, 2 h, 12 h, danach Schluss', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect(BACKOFF_MS).toHaveLength(5);
    expect(backoffMs(6)).toBeNull();
    expect(backoffMs(99)).toBeNull();
  });
});

describe('istPrivateIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1'])('%s ist privat', (ip) => {
    expect(istPrivateIp(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('%s ist öffentlich', (ip) => {
    expect(istPrivateIp(ip)).toBe(false);
  });
});

describe('pruefeWebhookZiel (injizierter Resolver)', () => {
  const oeffentlich = async () => ['93.184.216.34'];
  it('erlaubt öffentliche https/http-Ziele', async () => {
    expect(await pruefeWebhookZiel('https://hooks.example.com/x', { resolver: oeffentlich })).toEqual({ ok: true });
    expect(await pruefeWebhookZiel('http://hooks.example.com/x', { resolver: oeffentlich })).toEqual({ ok: true });
  });
  it('lehnt andere Schemas, Müll und Zugangsdaten ab', async () => {
    for (const u of ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'nonsense', 'https://user:pw@example.com/']) {
      expect((await pruefeWebhookZiel(u, { resolver: oeffentlich })).ok).toBe(false);
    }
  });
  it('lehnt localhost und IP-Literale im privaten Netz ab', async () => {
    for (const u of ['http://localhost:3000/x', 'http://foo.localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://10.0.0.5/', 'http://192.168.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://2130706433/', 'http://0x7f.1/', 'http://[::ffff:127.0.0.1]/']) {
      expect((await pruefeWebhookZiel(u, { resolver: oeffentlich })).ok, u).toBe(false);
    }
  });
  it('lehnt Hostnamen ab, die auf private Adressen auflösen (auch gemischt)', async () => {
    expect((await pruefeWebhookZiel('https://intern.example.com/', { resolver: async () => ['10.0.0.1'] })).ok).toBe(false);
    expect((await pruefeWebhookZiel('https://rebind.example.com/', { resolver: async () => ['93.184.216.34', '127.0.0.1'] })).ok).toBe(false);
    expect((await pruefeWebhookZiel('https://v6.example.com/', { resolver: async () => ['fe80::1'] })).ok).toBe(false);
  });
  it('lehnt nicht auflösbare Hosts ab', async () => {
    expect((await pruefeWebhookZiel('https://gibts-nicht.example/', { resolver: async () => { throw new Error('ENOTFOUND'); } })).ok).toBe(false);
    expect((await pruefeWebhookZiel('https://leer.example/', { resolver: async () => [] })).ok).toBe(false);
  });
  it('privatErlaubt erlaubt private Ziele, aber keine falschen Schemas', async () => {
    expect((await pruefeWebhookZiel('http://127.0.0.1:9999/x', { privatErlaubt: true })).ok).toBe(true);
    expect((await pruefeWebhookZiel('ftp://127.0.0.1/x', { privatErlaubt: true })).ok).toBe(false);
  });
});
