import { describe, it, expect } from 'vitest';
import { decodeEbcdic, looksLikeEbcdic, normalizeEbcdic } from '../ebcdic';

// "PRODUCTO BASICO GENERAL" / "Saldo Final $ 5,136.55" as extracted from an EBCDIC-encoded PDF
const ENCODED = [
  '×ÙÖÄäÃãÖ@ÂÁâÉÃÖ@ÇÅÕÅÙÁÓ',
  'â\u0081\u0093\u0084\u0096@Æ\u0089\u0095\u0081\u0093@[@õkñóöKõõ',
].join('\n');

const READABLE = [
  'Emitido por Openbank México, S.A., Institución de Banca Múltiple',
  'Lançamentos: compras e saques — Cartão de crédito 1234',
  'Opening/Closing Date 01/04/26 - 02/03/26',
].join('\n');

describe('ebcdic', () => {
  it('decodes letters, digits and punctuation', () => {
    expect(decodeEbcdic(ENCODED)).toBe('PRODUCTO BASICO GENERAL\nSaldo Final $ 5,136.55');
  });

  it('decodes accented characters', () => {
    expect(decodeEbcdic('ÔQ§\u0089\u0083\u0096')).toBe('México');
  });

  it('keeps the spaces, line breaks and page-break markers added by the extraction', () => {
    const text = ['×ÙÖÄäÃãÖ ÂÁâÉÃÖ', '--- PAGE BREAK ---', 'ÇÅÕÅÙÁÓ'].join('\n');
    expect(decodeEbcdic(text)).toBe('PRODUCTO BASICO\n--- PAGE BREAK ---\nGENERAL');
  });

  it('turns leftover control codes into spaces', () => {
    expect(decodeEbcdic('Á\u0000Â')).toBe('A B');
  });

  it('recognizes encoded text', () => {
    expect(looksLikeEbcdic(ENCODED.repeat(5))).toBe(true);
  });

  it('does not mistake readable text for encoded text', () => {
    expect(looksLikeEbcdic(READABLE.repeat(5))).toBe(false);
    expect(looksLikeEbcdic('')).toBe(false);
  });

  it('normalizeEbcdic decodes encoded text and leaves readable text untouched', () => {
    expect(normalizeEbcdic(ENCODED.repeat(5))).toContain('PRODUCTO BASICO GENERAL');
    expect(normalizeEbcdic(READABLE)).toBe(READABLE);
  });
});
