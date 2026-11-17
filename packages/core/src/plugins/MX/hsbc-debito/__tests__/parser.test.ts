import { describe, it, expect } from 'vitest';
import { hsbcDebitoParser } from '../index';
import { decodeEbcdic } from '../../../ebcdic';
import { parseStatement } from '../../../../parser';
import { plugins } from '../../../index';

const PAGE_HEADER = [
  'PRODUCTO BASICO GENERAL',
  'Estado de Cuenta',
  'FULANO DE TAL',
  'Emitido por: HSBC México S.A. Institución de Banca Múltiple, Grupo Financiero HSBC.',
  'Calle Ejemplo No. 1, Ciudad Ejemplo Tel. 55 0000-0000 PAG. 2/6',
  '4000001 20001',
];

const DETAIL_HEADER = [
  'DETALLE MOVIMIENTOS PRODUCTO BASICO GENERAL No.  0000001234',
  'Día Descripción Referencia/',
  'Serial Retiro/Cargo Depósito/Abono Saldo',
];

const TRANSFER_HEADER = [
  'Fecha de',
  'Operación',
  'Hora de',
  'Operación',
  'Participante',
  'Receptor',
  'Nombre del',
  'Beneficiario *',
  'Cuenta Beneficiaria Concepto del',
  'pago',
  'Monto del pago Clave de',
  'Rastreo',
  'Número de',
  'Referencia',
];

// Synthetic statement modeled after the (decoded) text of an HSBC Mexico account
// statement. All names, account numbers, references and amounts are fictitious.
function sample(period = '01/03/2026 al 31/03/2026', opening = true): string {
  return [
    'PRODUCTO BASICO GENERAL',
    'Estado de Cuenta',
    'Emitido por: HSBC México S.A. Institución de Banca Múltiple, Grupo Financiero HSBC.',
    'RESUMEN DE CUENTAS',
    `4 Período del ${period}`,
    ...DETAIL_HEADER,
    '02 CGO Transferencia SPEI 08040001',
    '5001001',
    '$ 200.00  $ 800.00',
    '05 NOMINA                          050326 19010001 $ 5,000.00  $ 5,800.00',
    '06 PAGO DE TARJETA: 4000000000001234 EN BPI 13650001',
    '41001',
    '$ 1,500.00  $ 4,300.00',
    '10 REEMBOLSO COMIDA                0100326 08040002',
    '1180001',
    '$ 150.50  $ 4,450.50',
    '--- PAGE BREAK ---',
    ...PAGE_HEADER,
    ...DETAIL_HEADER,
    '12 CGO Transferencia entre cuentas 08040001',
    '5002002',
    '$ 300.00  $ 4,150.50',
    '12 CGO Transferencia entre cuentas 08040001',
    '5002000',
    '$ 300.00  $ 3,850.50',
    'CoDi: Operación procesada por CoDi®',
    'Otros Cargos $2,300.00',
    'Saldo Final $3,850.50',
    ...(opening ? ['Saldo Inicial $            1,000.00'] : []),
    'Saldo Final $3,850.50',
    'Información SPEI´s Enviados durante el periodo del 01/03/2026 al 31/03/2026',
    ...TRANSFER_HEADER,
    '03/03/2026 05:37:15 *BANCOUNO Tienda',
    'Ejemplo',
    '00012345678900001111 Transferencia',
    'SPEI',
    '$ 200.00 HSB50010',
    '01',
    '000000000000',
    '00020326',
    '12/03/2026 10:00:00 *STP Cuenta Demo 00098765432100002222 Transferencia',
    'entre cuentas',
    '$ 300.00 HSB50020',
    '00',
    '000000000000',
    '01203261',
    '12/03/2026 10:01:00 *STP Cuenta Demo 00098765432100002222 Transferencia',
    'entre cuentas',
    '$ 300.00 HSBC5002',
    '002',
    '000000000000',
    '01203262',
    '* Dato no verificado por esta institución',
    'CoDi: Operación procesada por CoDi®',
    'Información SPEI´s Recibidos durante el periodo del 01/03/2026 al 31/03/2026',
    ...TRANSFER_HEADER,
    '11/03/2026 08:23:35 BANCODOS PERSONA',
    'DEMO',
    '00055555555500003333reembolso comida $ 150.50 085900001',
    '774300001',
    '000000000000',
    '00100326',
    'CoDi: Operación procesada por CoDi®',
    'Información CoDi® Enviados durante el periodo del 01/03/2026 al 31/03/2026',
    '* Dato no verificado por esta institución',
    'Mensajes Importantes',
    '15 No es un movimiento 08040009 $ 1.00  $ 2.00',
  ].join('\n');
}

const SAMPLE = sample();

// What `extractText` returns for the real PDFs: every character is an EBCDIC byte
const TO_EBCDIC = new Map<string, string>();
for (let byte = 0x40; byte <= 0xff; byte++) {
  const ch = decodeEbcdic(String.fromCharCode(byte));
  if (!TO_EBCDIC.has(ch)) TO_EBCDIC.set(ch, String.fromCharCode(byte));
}
function encode(text: string): string {
  return text
    .split('\n')
    .map(line => (line.startsWith('---') ? line : [...line].map(ch => TO_EBCDIC.get(ch) ?? ch).join('')))
    .join('\n');
}
const ENCODED_SAMPLE = encode(SAMPLE);

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('hsbcDebitoParser', () => {
  describe('detect', () => {
    it('detects an HSBC account statement', () => {
      expect(hsbcDebitoParser.detect(SAMPLE)).toBe(true);
    });

    it('detects the EBCDIC-encoded text of the real PDFs', () => {
      expect(ENCODED_SAMPLE).not.toContain('HSBC');
      expect(hsbcDebitoParser.detect(ENCODED_SAMPLE)).toBe(true);
    });

    it('requires both markers', () => {
      expect(hsbcDebitoParser.detect('HSBC México S.A.')).toBe(false);
      expect(hsbcDebitoParser.detect('DETALLE MOVIMIENTOS')).toBe(false);
    });

    it('is the parser picked for the statement by the detector', () => {
      expect(parseStatement(SAMPLE, plugins).bank).toBe('HSBC Débito');
      expect(parseStatement(ENCODED_SAMPLE, plugins).bank).toBe('HSBC Débito');
    });

    it('is still picked when a transfer names another bank', () => {
      const text = SAMPLE.replace('*BANCOUNO', '*NUBANK');
      expect(parseStatement(text, plugins).bank).toBe('HSBC Débito');
    });
  });

  describe('parse', () => {
    const txns = hsbcDebitoParser.parse(SAMPLE);

    it('parses every movement and nothing outside the table', () => {
      expect(txns).toHaveLength(6);
      expect(txns.some(t => t.description.includes('No es un movimiento'))).toBe(false);
    });

    it('gives the same result for the EBCDIC-encoded text', () => {
      const strip = (list: typeof txns) => list.map(({ raw: _raw, ...rest }) => rest);
      expect(strip(hsbcDebitoParser.parse(ENCODED_SAMPLE))).toEqual(strip(txns));
    });

    it('takes month and year from the statement period', () => {
      expect(txns.map(t => t.date)).toEqual([
        '2026-03-02',
        '2026-03-05',
        '2026-03-06',
        '2026-03-10',
        '2026-03-12',
        '2026-03-12',
      ]);
    });

    it('derives the direction from the running balance', () => {
      expect(txns.map(t => t.amount)).toEqual([-200, 5000, -1500, 150.5, -300, -300]);
      expect(txns.map(t => t.type)).toEqual(['debit', 'credit', 'debit', 'credit', 'debit', 'debit']);
      expect(sum(txns.map(t => t.amount))).toBe(sum([3850.5, -1000]));
    });

    it('parses a wrapped row with reference, serial and matching transfer', () => {
      expect(txns[0]).toMatchObject({
        date: '2026-03-02',
        description: 'CGO Transferencia SPEI',
        amount: -200,
        currency: 'MXN',
        type: 'debit',
        account: 'HSBC PRODUCTO BASICO GENERAL 1234',
        externalId: 'hsbc-debito:1234:20260302:80000:1',
        payee: 'BANCOUNO 1111',
        notes:
          'Ref. 08040001 / 5001001; SPEI enviado a BANCOUNO Tienda Ejemplo, cuenta 1111, 05:37:15; concepto: Transferencia SPEI',
      });
    });

    it('parses a single-line row and collapses the padding', () => {
      expect(txns[1]).toMatchObject({ description: 'NOMINA 050326', amount: 5000, notes: 'Ref. 19010001' });
      expect(txns[1].payee).toBeUndefined();
    });

    it('masks the card number of a card payment', () => {
      expect(txns[2].description).toBe('PAGO DE TARJETA: ****1234 EN BPI');
      expect(txns[2].raw).toContain('4000000000001234');
    });

    it('matches a received transfer dated a day apart', () => {
      expect(txns[3]).toMatchObject({
        description: 'REEMBOLSO COMIDA 0100326',
        payee: 'BANCODOS 3333',
        notes:
          'Ref. 08040002 / 1180001; SPEI recibido de BANCODOS PERSONA DEMO, cuenta 3333, 08:23:35; concepto: reembolso comida',
      });
    });

    it('pairs same-day transfers of the same amount by serial', () => {
      expect(txns[4].notes).toContain('10:01:00');
      expect(txns[5].notes).toContain('10:00:00');
    });

    it('continues the balance chain across a page break', () => {
      expect(txns[4]).toMatchObject({ amount: -300, externalId: 'hsbc-debito:1234:20260312:415050:1' });
      expect(txns.some(t => t.raw!.includes('PAGE BREAK') || t.raw!.includes('FULANO'))).toBe(false);
    });

    it('gives every row a unique externalId', () => {
      const ids = txns.map(t => t.externalId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('falls back to keywords when there is no opening balance', () => {
      const [first, second] = hsbcDebitoParser.parse(sample(undefined, false));
      expect(first.amount).toBe(-200); // "CGO" = charge
      expect(second.amount).toBe(5000); // chain is available from the second row on
    });

    it('dates rows of a period that spans two months', () => {
      const dates = hsbcDebitoParser.parse(sample('04/03/2026 al 03/04/2026')).map(t => t.date);
      expect(dates.slice(0, 3)).toEqual(['2026-04-02', '2026-03-05', '2026-03-06']);
    });

    it('returns nothing without a statement period', () => {
      expect(hsbcDebitoParser.parse(SAMPLE.replace(/Per[ií]odo del|periodo del/g, 'x'))).toEqual([]);
    });
  });
});
