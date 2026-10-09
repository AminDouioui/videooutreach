import { describe, expect, it } from 'vitest';
import { MAX_VARIANTEN, naechstesKuerzel, waehleVariante } from './varianten';

describe('waehleVariante', () => {
  it('nimmt ohne Zusatzvarianten immer A', () => {
    expect(waehleVariante([], {})).toBe('A');
    expect(waehleVariante([], { A: 7 })).toBe('A');
  });

  it('rotiert gleichmäßig; bei Gleichstand gewinnt das kleinere Kürzel', () => {
    const z: Record<string, number> = {};
    const folge: string[] = [];
    for (let i = 0; i < 7; i++) {
      const v = waehleVariante(['B', 'C'], z);
      z[v] = (z[v] ?? 0) + 1;
      folge.push(v);
    }
    expect(folge).toEqual(['A', 'B', 'C', 'A', 'B', 'C', 'A']);
  });

  it('gleicht Rückstand aus (neue Variante bekommt zuerst Mails) und ignoriert inaktive', () => {
    expect(waehleVariante(['B'], { A: 5 })).toBe('B');
    // C ist nicht aktiv, auch wenn sie am wenigsten hat
    expect(waehleVariante(['B'], { A: 2, B: 2, C: 0 })).toBe('A');
  });
});

describe('naechstesKuerzel', () => {
  it('vergibt das erste freie Kürzel und begrenzt auf 5 Varianten', () => {
    expect(naechstesKuerzel([])).toBe('B');
    expect(naechstesKuerzel(['B', 'D'])).toBe('C');
    expect(naechstesKuerzel(['B', 'C', 'D'])).toBe('E');
    expect(naechstesKuerzel(['B', 'C', 'D', 'E'])).toBeNull();
    expect(MAX_VARIANTEN).toBe(5);
  });
});
