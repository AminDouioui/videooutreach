import { describe, expect, it } from 'vitest';
import { isBotUserAgent } from './bots';

describe('isBotUserAgent', () => {
  it.each([
    '',
    'python-requests/2.31',
    'curl/8.0',
    'Mozilla/5.0 (compatible; Googlebot/2.1)',
    'Mozilla/5.0 Microsoft Office/16.0',
    'Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/120',
    'Mozilla/5.0 Mimecast',
    'Go-http-client/1.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Safelinks',
    'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)',
  ])('Bot: %s', (ua) => expect(isBotUserAgent(ua)).toBe(true));
  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  ])('Mensch: %s', (ua) => expect(isBotUserAgent(ua)).toBe(false));
});
