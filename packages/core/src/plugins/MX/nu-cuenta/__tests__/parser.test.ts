import { describe, it, expect } from 'vitest';
import { NU_ACCOUNTS, nuCuentaParser } from '../index';
import { parseStatement } from '../../../../parser';
import { plugins } from '../../../index';

const footer = (page: number) => [
  'Fulano de Tal',
  'Cuenta Nu: 00000000001',
  'Nu México Financiera, S.A. de C.V., S.F.P. Calle Ejemplo #1, Colonia Ejemplo,',
  'C.P. 00000, Ciudad Ejemplo, México. Teléfono: 800 000 0000',
  `${page} de 4`,
  '--- PAGE BREAK ---',
];

// Synthetic statement modeled after the extracted text of a Cuenta Nu (Nu México)
// statement. All names, account numbers, references and amounts are fictitious.
function sample({ period = 'del 01 al 29 feb 2024', cajitas = '$2,010.50', interest = '$10.50' } = {}): string {
  return [
    '¡Hola, Fulano!',
    'Este es tu estado de cuenta',
    'de Febrero',
    'Fulano de Tal',
    'Cuenta Nu: 00000000001',
    'RFC: XAXX010101000',
    'CLABE: 000000000000000000',
    `Periodo: ${period}`,
    'Saldo inicial $0.00',
    'Depósitos +$3,000.00',
    'Gastos -$250.00',
    'Comisiones cobradas por Nu $0.00',
    `Dinero generado este mes ${interest}`,
    'Saldo al generar este estado de cuenta $2,760.50',
    'Cómo está organizado tu dinero',
    'En su Cuenta',
    '$750.00',
    'En Cajitas',
    cajitas,
    'Nu México Financiera, S.A. de C.V., S.F.P. Calle Ejemplo #1, Colonia Ejemplo,',
    'C.P. 00000, Ciudad Ejemplo, México. Teléfono: 800 000 0000',
    '1 de 4',
    '--- PAGE BREAK ---',
    'Detalle de movimientos en tu cuenta',
    'FECHA DEL 01 AL 29 FEB 2024 (29 DÍAS) MONTO EN PESOS MEXICANOS',
    '20 FEB Retiro de Cajita: Vacaciones +$500.00',
    '15 FEB Tienda Ejemplo -$250.00',
    '14 FEB Depósito en Cajita: Vacaciones -$1,500.00',
    '14 FEB Depósito en Cajita: Vacaciones -$1,000.00',
    '13 FEB FULANO Deposito Demo +$3,000.00',
    'Depósito SPEI, Hora: 10:57:19, Recibido de BANCOUNO. Del cliente FULANO',
    'DE TAL (Dato no verificado por esta',
    'institución), por concepto Deposito Demo. De la cuenta',
    '000000000000001234 clabe, Clave de rastreo BCO000001, Clave de',
    'referencia 1302241',
    ...footer(2),
    'Detalle de movimientos en tu cuenta',
    'FECHA DEL 01 AL 29 FEB 2024 (29 DÍAS) MONTO EN PESOS MEXICANOS',
    '02 FEB Transferencia a un amigo con un concepto largo que',
    'ocupa dos renglones -$0.00',
    'Con estos movimientos, tu saldo promedio del periodo fue de $1,500.00',
    ...footer(3),
    'Detalle de movimientos de tus cajitas',
    'FECHA DEL 01 AL 29 FEB 2024 (29 DÍAS) MONTO EN PESOS MEXICANOS',
    '20 FEB Retiro de Cajita: Vacaciones -$500.00',
    '14 FEB Depósito en Cajita: Vacaciones +$1,500.00',
    '14 FEB Depósito en Cajita: Vacaciones +$1,000.00',
    ...footer(4),
    'DINERO GENERADO EN TU CUENTA NUDEL 01 AL 29 FEB 2024 (29 DÍAS)',
    'Dinero generado antes de impuestos (Interés Bruto de 15%) $10.55',
    'Impuestos sobre el dinero generado (ISR de 0.5%) $0.05',
    `Dinero generado este mes ${interest}`,
    '13 FEB No es un movimiento +$1.00',
  ].join('\n');
}

const SAMPLE = sample();
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('nuCuentaParser', () => {
  describe('detect', () => {
    it('detects a Cuenta Nu statement', () => {
      expect(nuCuentaParser.detect(SAMPLE)).toBe(true);
    });

    it('requires both markers', () => {
      expect(nuCuentaParser.detect('Nu México Financiera, S.A. de C.V.')).toBe(false);
      expect(nuCuentaParser.detect('Transferencia a Cuenta Nu')).toBe(false);
    });

    it('is the parser picked for the statement by the detector', () => {
      expect(parseStatement(SAMPLE, plugins).bank).toBe('Nu Cuenta');
    });

    it('is still picked when a transfer names another bank', () => {
      expect(parseStatement(SAMPLE.replace('BANCOUNO', 'NUBANK'), plugins).bank).toBe('Nu Cuenta');
    });
  });

  describe('parse', () => {
    const txns = nuCuentaParser.parse(SAMPLE);
    const cuenta = txns.filter(t => t.account === NU_ACCOUNTS.cuenta);
    const cajitas = txns.filter(t => t.account === NU_ACCOUNTS.cajitas);

    it('parses both tables plus the interest row, and nothing outside the tables', () => {
      expect(cuenta).toHaveLength(6);
      expect(cajitas).toHaveLength(4);
      expect(txns.some(t => t.description.includes('No es un movimiento'))).toBe(false);
    });

    it('matches the statement totals', () => {
      // deposits - expenses + interest = closing balance (opening balance 0)
      expect(sum(txns.map(t => t.amount))).toBe(2760.5);
      expect(sum(cuenta.map(t => t.amount))).toBe(750);
      expect(sum(cajitas.map(t => t.amount))).toBe(2010.5);
    });

    it('returns each table in chronological order with the year of the period', () => {
      expect(cuenta.map(t => t.date)).toEqual([
        '2024-02-02',
        '2024-02-13',
        '2024-02-14',
        '2024-02-14',
        '2024-02-15',
        '2024-02-20',
      ]);
    });

    it('uses the printed sign', () => {
      expect(cuenta.map(t => t.amount)).toEqual([-0, 3000, -1000, -1500, -250, 500]);
      expect(cuenta[1].type).toBe('credit');
      expect(cuenta[4].type).toBe('debit');
    });

    it('joins a title that wraps before the amount', () => {
      expect(cuenta[0].description).toBe('Transferencia a un amigo con un concepto largo que ocupa dos renglones');
    });

    it('puts the SPEI detail in notes and the counterparty in payee', () => {
      expect(cuenta[1]).toMatchObject({
        description: 'FULANO Deposito Demo',
        amount: 3000,
        currency: 'MXN',
        payee: 'BANCOUNO 1234',
        externalId: 'nu-cuenta:20240213:300000:1',
        notes:
          'Depósito SPEI, Hora: 10:57:19, Recibido de BANCOUNO. Del cliente FULANO DE TAL (Dato no verificado por esta institución), por concepto Deposito Demo. De la cuenta 000000000000001234 clabe, Clave de rastreo BCO000001, Clave de referencia 1302241',
      });
    });

    it('keeps the page footer out of the movement detail', () => {
      expect(cuenta[1].notes).not.toContain('Fulano de Tal');
      expect(txns.some(t => (t.notes ?? '').includes('Cuenta Nu:') || t.raw!.includes('PAGE BREAK'))).toBe(false);
    });

    it('pairs Cajita movements of both tables as one transfer', () => {
      const out = cuenta.filter(t => t.counterAccount === NU_ACCOUNTS.cajitas);
      const inn = cajitas.filter(t => t.counterAccount === NU_ACCOUNTS.cuenta);
      expect(out).toHaveLength(3);
      expect(inn).toHaveLength(3);
      expect(out.map(t => t.externalId).sort()).toEqual(inn.map(t => t.externalId).sort());
      expect(out.map(t => t.externalId)).toEqual([
        'nu-xfer:20240214:100000:1',
        'nu-xfer:20240214:150000:1',
        'nu-xfer:20240220:50000:1',
      ]);
      for (const t of out) {
        const mirror = inn.find(m => m.externalId === t.externalId)!;
        expect(mirror.amount).toBe(-t.amount);
        expect(mirror.description).toBe(t.description);
      }
    });

    it('leaves other movements without a counter account', () => {
      expect(cuenta[4]).toMatchObject({ description: 'Tienda Ejemplo', amount: -250 });
      expect(cuenta[4].counterAccount).toBeUndefined();
      expect(cuenta[4].payee).toBeUndefined();
    });

    it('adds the net interest of the summary on the last day of the period', () => {
      expect(cajitas[3]).toMatchObject({
        date: '2024-02-29',
        description: 'Dinero generado este mes',
        amount: 10.5,
        type: 'credit',
        payee: 'Nu',
        category: 'Rendimientos',
        externalId: 'nu-interes:20240229',
      });
    });

    it('credits the interest to the account when the Cajitas are empty', () => {
      const interest = nuCuentaParser.parse(sample({ cajitas: '$0.00' })).at(-1)!;
      expect(interest.account).toBe(NU_ACCOUNTS.cuenta);
    });

    it('adds no interest row when nothing was earned', () => {
      const none = nuCuentaParser.parse(sample({ interest: '$0.00' }));
      expect(none.some(t => t.category === 'Rendimientos')).toBe(false);
    });

    it('parses a month without movements (interest only)', () => {
      const text = SAMPLE.split('\n')
        .filter(l => !/^Detalle de movimientos|^\d{2} FEB/.test(l))
        .join('\n');
      const only = nuCuentaParser.parse(text);
      expect(only).toHaveLength(1);
      expect(only[0].category).toBe('Rendimientos');
    });

    it('gives unpaired rows unique externalIds', () => {
      const ids = txns.filter(t => !t.counterAccount).map(t => t.externalId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('dates December rows of a period that ends in January', () => {
      const text = sample({ period: 'del 15 dic al 14 ene 2025' }).replace(/(\d{2}) FEB (Tienda)/, '20 DIC $2');
      const row = nuCuentaParser.parse(text).find(t => t.description === 'Tienda Ejemplo')!;
      expect(row.date).toBe('2024-12-20');
    });

    it('returns nothing without a statement period', () => {
      expect(nuCuentaParser.parse(SAMPLE.replace('Periodo:', 'x'))).toEqual([]);
    });
  });
});
