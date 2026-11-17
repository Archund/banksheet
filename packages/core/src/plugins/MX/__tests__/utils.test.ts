import { describe, it, expect } from 'vitest';
import { ES_MONTHS, compactDate, occurrenceCounter, parseMXAmount, round2, toCents } from '../utils';

describe('MX utils', () => {
  it('parseMXAmount handles thousands and currency sign', () => {
    expect(parseMXAmount('1,234.56')).toBe(1234.56);
    expect(parseMXAmount('$ 9,876.00')).toBe(9876);
  });

  it('round2 removes float noise', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(41027 - 41015)).toBe(12);
  });

  it('toCents returns integer cents', () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(-0.29)).toBe(-29);
  });

  it('compactDate strips dashes', () => {
    expect(compactDate('2026-03-05')).toBe('20260305');
  });

  it('occurrenceCounter numbers repeated keys independently', () => {
    const next = occurrenceCounter();
    expect([next('a'), next('b'), next('a'), next('a')]).toEqual([1, 1, 2, 3]);
  });

  it('ES_MONTHS maps Spanish month abbreviations', () => {
    expect(ES_MONTHS.ene).toBe('01');
    expect(ES_MONTHS.ago).toBe('08');
    expect(ES_MONTHS.dic).toBe('12');
    expect(Object.keys(ES_MONTHS)).toHaveLength(12);
  });
});
