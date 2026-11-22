import { describe, it, expect } from 'vitest';
import { nuCreditoParser } from '../index';
import { nuDebitoParser } from '../../nu-debito/index';
import { detectBank } from '../../../../detector';
import { plugins } from '../../../index';

const pageHeader = (page: number) => [
  '--- PAGE BREAK ---',
  'Número de tarjeta: XXXX-XXXX-XXXX-0000',
  `Página ${page} de 6`,
];

const tableHeader = [
  'CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)',
  'Tarjeta titular: Fulano de Tal',
  'Fecha de la',
  'operación Fecha de cargo MontoDescripción del movimiento',
];

const footer = [
  'ATENCIÓN DE QUEJAS Nubank, S.A. Institución de Banca Múltiple, recibe las consultas, reclamaciones o',
  'aclaraciones en su Unidad Especializada de Atención a Usuarios, ubicada en Calle Ejemplo 1,',
  'Notas: Ver notas en la sección “NOTAS ACLARATORIAS” en este estado de cuenta',
];

// Synthetic statement modeled after the extracted text of a Nu México credit card statement.
// All names, card numbers, merchants and amounts are fictitious.
function sample(rows: string[], totals = ['+$1,399.90', '-$500.00']): string {
  return [
    'Página 1 de 6¡Hola, Fulano!',
    'Este es tu estado de cuenta de noviembre',
    'FULANO DE TAL',
    'Producto: Tarjeta de Crédito Nu, Oro',
    'Número de tarjeta: XXXX-XXXX-XXXX-0000',
    'RFC: XAXX010101000',
    'Periodo: 26 SEP 2026 al 26 OCT 2026',
    'Fecha de corte: 26 OCT 2026',
    'RESUMEN DE CARGOS Y ABONOS DEL PERIODO',
    'Pagos y abonos - $500.00',
    ...pageHeader(3),
    'DESGLOSE DE MOVIMIENTOS',
    'COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES',
    '05 SEP 2026 Recarga - Telefonía Ejemplo $150.00 $0.00 $150.00 1/1 0.00%',
    ...pageHeader(4),
    ...tableHeader,
    ...rows,
    ...totals,
    'Total de cargos',
    'Total de abonos',
    ...footer,
    ...pageHeader(5),
    'NOTAS ACLARATORIAS',
    '1. Tienes como límite esta fecha para realizar tu pago.',
  ].join('\n');
}

const ROWS = [
  '26 SEP 2026 26 SEP 2026 ¡Gracias por tu pago! | RFC: S.I. -$500.00',
  'Abono (con cuenta Nu)',
  '02 OCT 2026 02 OCT 2026 Tda Tienda Ejemplo | RFC: S.I. +$150.00',
  '04 OCT 2026 05 OCT 2026 Wl *Juegos Ejemplo Purchase | RFC: S.I. +$249.90',
  'Cambio (USD 1 = $18.50) USD 9.15',
  '10 OCT 2026 10 OCT 2026 Farmacia Ejemplo | RFC: FEJ010101AB1 +$1,000.00',
];

describe('Nu Crédito parser', () => {
  it('detects a Nu México credit card statement', () => {
    expect(nuCreditoParser.detect(sample(ROWS))).toBe(true);
    expect(detectBank(sample(ROWS), plugins)?.name).toBe('Nu Crédito');
  });

  it('is detected before Nu Débito when both would match ("con cuenta Nu" + the Cuenta Nu issuer line)', () => {
    const both = `${sample(ROWS)}\nNubank, S.A., Institución de Banca Múltiple`;
    expect(nuDebitoParser.detect(both)).toBe(true);
    expect(detectBank(both, plugins)?.name).toBe('Nu Crédito');
  });

  it('does not detect a Cuenta Nu statement that pays the card', () => {
    const debit = [
      'Cuenta Nu: 00000000001',
      'Pago a tu tarjeta de crédito Nu -$500.00',
      'Nubank, S.A., Institución de Banca Múltiple',
    ].join('\n');
    expect(nuCreditoParser.detect(debit)).toBe(false);
  });

  it('parses charges (negative) and payments (positive) with both dates', () => {
    const tx = nuCreditoParser.parse(sample(ROWS));
    expect(tx).toHaveLength(4);
    expect(tx.map((t) => t.amount)).toEqual([500, -150, -249.9, -1000]);
    expect(tx.map((t) => t.type)).toEqual(['credit', 'debit', 'debit', 'debit']);
    expect(tx.every((t) => t.account === 'Nu Tarjeta de Crédito' && t.currency === 'MXN')).toBe(true);
    expect(tx[2].date).toBe('2026-10-04');
    expect(tx[2].bookingDate).toBe('2026-10-05');
    expect(tx[1].bookingDate).toBeUndefined();
  });

  it('matches the statement totals', () => {
    const tx = nuCreditoParser.parse(sample(ROWS));
    const charges = tx.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const credits = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    expect(Math.round(charges * 100)).toBe(-139990);
    expect(credits).toBe(500);
  });

  it('links a payment from the Cuenta Nu with the Nu Débito row ID', () => {
    const [payment] = nuCreditoParser.parse(sample(ROWS));
    expect(payment.counterAccount).toBe('Nu Débito');
    expect(payment.externalId).toBe('nu-debito:cuenta:20260926:-50000:1');
    expect(payment.payee).toBeUndefined();
    expect(payment.notes).toBe('Abono (con cuenta Nu)');
  });

  it('keeps a payment from elsewhere as a plain credit', () => {
    const tx = nuCreditoParser.parse(sample(['26 SEP 2026 26 SEP 2026 ¡Gracias por tu pago! | RFC: S.I. -$500.00']));
    expect(tx[0].counterAccount).toBeUndefined();
    expect(tx[0].externalId).toBe('nu-credito:20260926:50000:1');
  });

  it('cleans the merchant name for payee and reads the exchange line', () => {
    const tx = nuCreditoParser.parse(sample(ROWS));
    expect(tx[1].payee).toBe('Tienda Ejemplo');
    expect(tx[2].payee).toBe('Juegos Ejemplo');
    expect(tx[2].exchangeRate).toBe(18.5);
    expect(tx[2].notes).toBe('USD 9.15');
    expect(tx[3].payee).toBe('Farmacia Ejemplo');
    expect(tx[3].notes).toBe('RFC: FEJ010101AB1');
    expect(tx[1].description).toBe('Tda Tienda Ejemplo');
  });

  it('numbers otherwise identical rows', () => {
    const same = '18 NOV 2026 18 NOV 2026 Tda Tienda Ejemplo | RFC: S.I. +$150.00';
    const tx = nuCreditoParser.parse(sample([same, same]));
    expect(tx.map((t) => t.externalId)).toEqual(['nu-credito:20261118:-15000:1', 'nu-credito:20261118:-15000:2']);
  });

  it('continues the table across pages and ignores the totals and the installments table', () => {
    const rows = [ROWS[2], ...pageHeader(5), ...tableHeader, ROWS[5]];
    const tx = nuCreditoParser.parse(sample(rows, ['+$1,150.00', '$0.00']));
    expect(tx).toHaveLength(2);
    expect(tx.every((t) => t.notes === undefined || t.notes.startsWith('RFC'))).toBe(true);
  });

  it('returns no rows for a statement without movements', () => {
    expect(nuCreditoParser.parse(sample([], ['$0.00', '$0.00']))).toEqual([]);
  });
});
