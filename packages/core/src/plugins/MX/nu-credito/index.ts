import type { BankParser, Transaction } from '../../../types';
import { ES_MONTHS, compactDate, occurrenceCounter, parseMXAmount, toCents } from '../utils';
import { NU_ACCOUNTS } from '../nu-debito/index';

// Hoisted regexes — compiled once at module load

// Issuer line (same as the Cuenta Nu statements) + the product line of page 1
const ISSUER_RE = /Nu México Financiera|Nubank, S\.A\.,? Instituci[oó]n de Banca M[uú]ltiple/i;
const PRODUCT_RE = /Tarjeta de Cr[eé]dito Nu\b/i;
// The movement table: "CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)"
const SECTION_RE = /^CARGOS, ABONOS Y COMPRAS REGULARES/i;
const SECTION_END_RE = /^(Total de cargos|Total de abonos|ATENCI[OÓ]N DE QUEJAS|NOTAS ACLARATORIAS)/i;
// Table header, cardholder line and page furniture repeated on every page
const SKIP_RE = /^(---|Fecha de la\b|operaci[oó]n\b|N[uú]mero de tarjeta:|P[aá]gina \d+ de \d+|Tarjeta (titular|adicional)\b|Notas:)/i;
// The two totals printed above "Total de cargos / Total de abonos"
const AMOUNT_ONLY_RE = /^[+-]?\$[\d,]+\.\d{2}$/;
// "05 SEP 2026 06 SEP 2026 Recarga - Telefonía Ejemplo | RFC: S.I. +$150.00": operation date, posting date,
// description, RFC of the merchant, signed amount ("+" = charge, "-" = payment / credit)
const MONTHS = 'ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC';
const ROW_RE = new RegExp(
  `^(\\d{2}) (${MONTHS}) (\\d{4}) (\\d{2}) (${MONTHS}) (\\d{4}) (.+?)\\s*([+-])\\$([\\d,]+\\.\\d{2})$`, 'i',
);
const RFC_RE = /\s*\|\s*RFC:\s*(.*)$/;
// "Cambio (USD 1 = $17.25) USD 9.99"
const EXCHANGE_RE = /^Cambio \(([A-Z]{3}) 1 = \$([\d,]+\.\d+)\)\s+([A-Z]{3})\s+([\d,]+\.\d{2})$/;
const PAYMENT_RE = /^¡?Gracias por tu pago!?$/i;
const FROM_NU_ACCOUNT_RE = /con cuenta Nu/i;
// Payment-processor prefixes in front of the merchant name ("Wl *Tienda", "Tda Tienda", "Recarga - Telefonía")
const PAYEE_PREFIX_RE = /^(Recarga\s*-\s*|Tda\s+|[A-Za-z]{2,8}\s?\*\s*)/;
const PAYEE_SUFFIX_RE = /\s+Purchase$/i;

interface Row {
  date: string;
  bookingDate: string;
  description: string;
  rfc: string;
  amount: number; // signed for the cardholder: charges negative
  detail: string[];
  raw: string[];
}

export const nuCreditoParser: BankParser = {
  name: 'Nu Crédito',
  country: 'MX',

  detect(text: string): boolean {
    return ISSUER_RE.test(text) && PRODUCT_RE.test(text) && /CARGOS, ABONOS Y COMPRAS REGULARES/i.test(text);
  },

  /**
   * Parses the "CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)" table of a Nu México credit card statement.
   *
   * - Each row prints the operation date (`date`) and the posting date (`bookingDate`), the description with
   *   the merchant's RFC, and a signed amount: "+" is a charge (negative here), "-" a payment or credit.
   * - Lines under a row are detail: the exchange line of a purchase ("Cambio (USD 1 = $17.25) USD 9.99")
   *   gives `exchangeRate` and the original amount in `notes`; anything else goes to `notes`.
   * - A payment made from the Cuenta Nu ("¡Gracias por tu pago!" + "Abono (con cuenta Nu)") gets
   *   `counterAccount` = `Nu Débito` and the same `externalId` the Nu Débito parser gives the payment row
   *   in the account statement, so an importer records the transfer once.
   */
  parse(text: string): Transaction[] {
    const rows = collectRows(text);
    const nextN = occurrenceCounter();
    const nextPaymentN = occurrenceCounter();

    return rows.map((row) => {
      const cents = toCents(row.amount);
      const notes = [...row.detail];
      const tx: Transaction = {
        date: row.date,
        description: row.description,
        amount: row.amount,
        currency: 'MXN',
        type: row.amount < 0 ? 'debit' : 'credit',
        raw: row.raw.join(' '),
        account: NU_ACCOUNTS.credito,
      };
      if (row.bookingDate !== row.date) tx.bookingDate = row.bookingDate;

      for (let i = notes.length - 1; i >= 0; i--) {
        const ex = notes[i].match(EXCHANGE_RE);
        if (ex) {
          tx.exchangeRate = parseMXAmount(ex[2]);
          notes[i] = `${ex[3]} ${ex[4]}`;
        }
      }
      if (row.rfc && !/^S\.?I\.?$/i.test(row.rfc)) notes.push(`RFC: ${row.rfc}`);

      const isPayment = row.amount > 0 && PAYMENT_RE.test(row.description);
      if (isPayment && row.detail.some((d) => FROM_NU_ACCOUNT_RE.test(d))) {
        tx.counterAccount = NU_ACCOUNTS.cuenta;
        // The account side of this payment is "nu-debito:cuenta:<date>:<-cents>:<n>" (a withdrawal)
        tx.externalId = `nu-debito:cuenta:${compactDate(row.date)}:${-cents}:${nextPaymentN(`${row.date}|${cents}`)}`;
      } else {
        tx.externalId = `nu-credito:${compactDate(row.date)}:${cents}:${nextN(`${row.date}|${cents}`)}`;
        if (!isPayment) tx.payee = merchant(row.description);
      }
      if (notes.length) tx.notes = notes.join('; ');
      return tx;
    });
  },
};

function isoDate(day: string, month: string, year: string): string {
  return `${year}-${ES_MONTHS[month.toLowerCase()]}-${day}`;
}

function collectRows(text: string): Row[] {
  const rows: Row[] = [];
  let inSection = false;
  let current: Row | undefined;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (SECTION_RE.test(line)) {
      inSection = true;
      current = undefined;
      continue;
    }
    if (!inSection) continue;
    if (SECTION_END_RE.test(line)) {
      inSection = false;
      current = undefined;
      continue;
    }
    if (SKIP_RE.test(line) || AMOUNT_ONLY_RE.test(line)) continue;

    const m = line.match(ROW_RE);
    if (m) {
      const [, d1, m1, y1, d2, m2, y2, body, sign, value] = m;
      const rfc = body.match(RFC_RE);
      const amount = parseMXAmount(value);
      current = {
        date: isoDate(d1, m1, y1),
        bookingDate: isoDate(d2, m2, y2),
        description: (rfc ? body.slice(0, rfc.index) : body).trim(),
        rfc: rfc ? rfc[1].trim() : '',
        amount: sign === '+' ? -amount : amount,
        detail: [],
        raw: [line],
      };
      rows.push(current);
    } else if (current) {
      current.detail.push(line);
      current.raw.push(line);
    }
  }
  return rows;
}

/** Merchant name for `payee`: the description without payment-processor prefixes. */
function merchant(description: string): string {
  const name = description.replace(PAYEE_PREFIX_RE, '').replace(PAYEE_SUFFIX_RE, '').trim();
  return name || description;
}
