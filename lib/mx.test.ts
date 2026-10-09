import { beforeEach, describe, expect, it } from 'vitest';
import { leereMxCache, pruefeDomains, type DnsResolver } from './mx';

const fehler = (code: string): DnsResolver => async () => {
  throw Object.assign(new Error(code), { code });
};
const liefert = (...eintraege: unknown[]): DnsResolver => async () => eintraege;

beforeEach(() => leereMxCache());

describe('pruefeDomains', () => {
  it('MX vorhanden = ok', async () => {
    const r = await pruefeDomains(['firma.de'], liefert({ exchange: 'mx.firma.de', priority: 10 }), 100, fehler('ENOTFOUND'), fehler('ENOTFOUND'));
    expect(r.get('firma.de')).toBe('ok');
  });

  it('ENOTFOUND bei MX und A/AAAA = kein_mx', async () => {
    const r = await pruefeDomains(['tot.de'], fehler('ENOTFOUND'), 100, fehler('ENOTFOUND'), fehler('ENODATA'));
    expect(r.get('tot.de')).toBe('kein_mx');
  });

  it('ohne MX, aber mit A-Record = ok (RFC 5321)', async () => {
    const r = await pruefeDomains(['nurweb.de'], fehler('ENODATA'), 100, liefert('1.2.3.4'), fehler('ENODATA'));
    expect(r.get('nurweb.de')).toBe('ok');
  });

  it('ohne MX und A, aber mit AAAA = ok', async () => {
    const r = await pruefeDomains(['v6.de'], fehler('ENODATA'), 100, fehler('ENODATA'), liefert('::1'));
    expect(r.get('v6.de')).toBe('ok');
  });

  it('Null-MX (".") = kein_mx ohne A-Fallback', async () => {
    const r = await pruefeDomains(['keinmail.de'], liefert({ exchange: '.', priority: 0 }), 100, liefert('1.2.3.4'), liefert('::1'));
    expect(r.get('keinmail.de')).toBe('kein_mx');
  });

  it('Netzfehler und Serverfehler = unbekannt, nicht kein_mx', async () => {
    expect((await pruefeDomains(['a.de'], fehler('ECONNREFUSED'), 100, fehler('ENOTFOUND'), fehler('ENOTFOUND'))).get('a.de')).toBe('unbekannt');
    leereMxCache();
    expect((await pruefeDomains(['b.de'], fehler('ESERVFAIL'), 100, fehler('ENOTFOUND'), fehler('ENOTFOUND'))).get('b.de')).toBe('unbekannt');
  });

  it('Fehler beim A-Fallback (nicht ENOTFOUND) = unbekannt', async () => {
    const r = await pruefeDomains(['c.de'], fehler('ENOTFOUND'), 100, fehler('ETIMEOUT'), fehler('ENOTFOUND'));
    expect(r.get('c.de')).toBe('unbekannt');
  });

  it('Timeout = unbekannt', async () => {
    const haengt: DnsResolver = () => new Promise(() => {});
    const r = await pruefeDomains(['langsam.de'], haengt, 20, fehler('ENOTFOUND'), fehler('ENOTFOUND'));
    expect(r.get('langsam.de')).toBe('unbekannt');
  });

  it('cached je Domain (nur eine Abfrage), unbekannt wird nicht gemerkt', async () => {
    let aufrufe = 0;
    const zaehlt: DnsResolver = async () => {
      aufrufe++;
      return [{ exchange: 'mx', priority: 1 }];
    };
    await pruefeDomains(['x.de', 'X.de', ' x.de '], zaehlt, 100);
    await pruefeDomains(['x.de'], zaehlt, 100);
    expect(aufrufe).toBe(1);

    let versuche = 0;
    const erstFehler: DnsResolver = async () => {
      versuche++;
      if (versuche === 1) throw Object.assign(new Error('t'), { code: 'ETIMEOUT' });
      return [{ exchange: 'mx', priority: 1 }];
    };
    expect((await pruefeDomains(['y.de'], erstFehler, 100)).get('y.de')).toBe('unbekannt');
    expect((await pruefeDomains(['y.de'], erstFehler, 100)).get('y.de')).toBe('ok');
  });

  it('begrenzt die Parallelität auf 10', async () => {
    let aktiv = 0;
    let max = 0;
    const r: DnsResolver = async () => {
      aktiv++;
      max = Math.max(max, aktiv);
      await new Promise((res) => setTimeout(res, 5));
      aktiv--;
      return [{ exchange: 'mx', priority: 1 }];
    };
    const domains = Array.from({ length: 40 }, (_, i) => `d${i}.de`);
    const out = await pruefeDomains(domains, r, 1000);
    expect(out.size).toBe(40);
    expect(max).toBeLessThanOrEqual(10);
    expect(max).toBeGreaterThan(1);
  });
});
