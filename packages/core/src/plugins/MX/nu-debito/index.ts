import type { BankParser, Transaction } from '../../../types';
import { ES_MONTHS, compactDate, occurrenceCounter, parseMXAmount, round2, toCents } from '../utils';

// Hoisted regexes — compiled once at module load

// "Periodo: del 01 al 29 feb 2024" (summary page)
const PERIOD_RE = /Periodo:\s*del\s+(\d{1,2})(?:\s+(?:de\s+)?([a-zé]{3})[a-z]*\.?(?:\s+(?:de\s+)?(\d{4}))?)?\s+al\s+(\d{1,2})\s+(?:de\s+)?([a-zé]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})/i;
// Section headers; both tables use the same row layout
const ACCOUNT_SECTION_RE = /^Detalle de movimientos en tu cuenta/i;
const CAJITAS_SECTION_RE = /^Detalle de movimientos de tus cajitas/i;
const SECTION_END_RE = /^(Con estos movimientos|DINERO GENERADO|CONTACTO\b|Número de serie)/i;
// A movement: "14 FEB <title> +$15,000.00" or, since mid-2024, "14 JUN 2024 <title> -$2,000.00"
// (the year can wrap to the next line). The sign is printed; rows are listed newest first.
const ROW_START_RE = /^(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\b\.?(?:\s+(\d{4})\b)?\s*(.*)$/i;
const LEADING_YEAR_RE = /^(\d{4})\b\s*/;
const AMOUNT_TAIL_RE = /(?:^|\s)([+-])\s*\$\s*([\d,]+\.\d{2})\s*$/;
const MAX_TITLE_LINES = 4;
// Page footer: customer name, "Cuenta Nu: <number>", the bank's address, "2 de 6"
const FOOTER_ACCOUNT_RE = /^Cuenta Nu:/i;
const NOT_DETAIL_RE = /^(---|FECHA DEL\b|Nu México Financiera|Nubank, S\.A\.|C\.P\.|\d+ de \d+$)/i;

// SPEI detail printed under a movement:
//   "Depósito SPEI, Hora: 10:57:19, Recibido de BANCO. Del cliente ... De la cuenta 0123... clabe, Clave de rastreo ..."
const SPEI_BANK_RE = /(?:Recibido de|Enviado a)\s+([^.,]+)[.,]/i;
const SPEI_ACCOUNT_RE = /(?:De|A) la cuenta\s+(\d{4,})/i;
const CAJITA_RE = /cajita/i;
// Freezing / unfreezing moves money between "Disponible" and "Congelado" inside the Cajitas:
// the Cajitas total does not change, so these rows are not transactions.
const FREEZE_RE = /^(Congelaste saldo|Descongelamos saldo)\b/i;
// Debit card rows: "<MERCHANT> Compra" / "<MERCHANT> Devolución"
const CARD_ROW_RE = /^(.+?)\s+(?:Compra|Devoluci[oó]n)$/i;
const CARD_PAYMENT_RE = /^Pago a tu tarjeta de cr[eé]dito Nu$/i;
// Issuer line of the page footer: "Nu México Financiera, S.A. de C.V., S.F.P." until 2025,
// "Nubank, S.A., Institución de Banca Múltiple" since Nu became a bank
const ISSUER_RE = /Nu México Financiera|Nubank, S\.A\., Instituci[oó]n de Banca M[uú]ltiple/i;

// Summary: money earned in the period, net of tax ("Dinero generado este mes $160.91")
const INTEREST_RE = /^Dinero generado este mes\s+\$\s*([\d,]+\.\d{2})\s*$/im;

/** Stable account names used in the `account` / `counterAccount` fields. */
export const NU_ACCOUNTS = {
  cuenta: 'Nu Débito',
  cajitas: 'Nu Cajitas',
  credito: 'Nu Tarjeta de Crédito',
} as const;

/** Name used as payee for rows the bank itself originates (interest). */
const NU_PAYEE = 'Nu';

type SectionKey = 'cuenta' | 'cajitas';

interface Period {
  start: string; // ISO
  end: string;
}

interface Row {
  section: SectionKey;
  date: string;
  title: string;
  detail: string[];
  amount: number;
  raw: string[];
  partner?: number; // index of the matching row in the other section (cuenta <-> cajitas)
}

export const nuDebitoParser: BankParser = {
  name: 'Nu Débito',
  country: 'MX',

  detect(text: string): boolean {
    return ISSUER_RE.test(text) && /Cuenta Nu/i.test(text);
  },

  /**
   * A Cuenta Nu statement holds two tables with the same layout: the account
   * ("Detalle de movimientos en tu cuenta") and the Cajitas ("Detalle de
   * movimientos de tus cajitas"). A month without movements has neither.
   *
   * - Rows print day and month ("14 FEB", later "14 JUN 2024") and a signed
   *   amount; a missing year comes from the statement period. Rows are listed
   *   newest first and are returned in chronological order.
   * - Freezing and unfreezing a Cajita ("Congelaste saldo", "Descongelamos
   *   saldo") does not change the Cajitas total and is skipped.
   * - Money moved into or out of a Cajita appears in both tables with opposite
   *   signs: both sides get the same `externalId` and each other's account as
   *   `counterAccount`, so an importer sees one transfer.
   * - The SPEI detail under a movement goes to `notes`, and the counterparty to
   *   `payee` as "<BANK> <last 4 digits>".
   * - Interest is not listed as a movement: the net "Dinero generado este mes"
   *   of the summary becomes one Cajitas row on the last day of the period.
   */
  parse(text: string): Transaction[] {
    const period = findPeriod(text);
    if (!period) return [];

    const rows = collectRows(text, period);
    pairTransfers(rows);
    const transactions = buildTransactions(rows);
    const interest = buildInterest(text, period);
    if (interest) transactions.push(interest);
    return transactions;
  },
};

function monthNumber(name: string | undefined): string | undefined {
  return name ? ES_MONTHS[name.toLowerCase().slice(0, 3)] : undefined;
}

function findPeriod(text: string): Period | undefined {
  const m = text.match(PERIOD_RE);
  if (!m) return undefined;
  const endMonth = monthNumber(m[5]);
  if (!endMonth) return undefined;
  const endYear = m[6];
  const startMonth = monthNumber(m[2]) ?? endMonth;
  // "del 15 dic al 14 ene 2025": the start belongs to the previous year
  const startYear = m[3] ?? (startMonth > endMonth ? String(Number(endYear) - 1) : endYear);
  return {
    start: `${startYear}-${startMonth}-${m[1].padStart(2, '0')}`,
    end: `${endYear}-${endMonth}-${m[4].padStart(2, '0')}`,
  };
}

/** Full date of a row: the year of the period in which that day and month fall. */
function resolveDate(day: string, month: string, period: Period): string {
  const endYear = period.end.slice(0, 4);
  const date = `${endYear}-${month}-${day.padStart(2, '0')}`;
  return date > period.end ? `${Number(endYear) - 1}${date.slice(4)}` : date;
}

function collectRows(text: string, period: Period): Row[] {
  const sections: Record<SectionKey, Row[]> = { cuenta: [], cajitas: [] };
  let section: SectionKey | null = null;
  // Row whose title is still wrapping (no amount yet), then the row collecting detail lines
  let pending: { day: string; month: string; year?: string; parts: string[]; raw: string[] } | null = null;
  let current: Row | null = null;

  const feedTitle = (fragment: string): void => {
    if (!pending || !section) return;
    if (!pending.year && pending.parts.length === 0) {
      const year = fragment.match(LEADING_YEAR_RE);
      if (year) {
        pending.year = year[1];
        fragment = fragment.slice(year[0].length);
      }
    }
    const amount = fragment.match(AMOUNT_TAIL_RE);
    const head = (amount ? fragment.slice(0, amount.index) : fragment).trim();
    if (head) pending.parts.push(head);
    if (!amount) {
      if (pending.parts.length > MAX_TITLE_LINES) pending = null; // not a real row
      return;
    }
    const value = parseMXAmount(amount[2]);
    const title = pending.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (FREEZE_RE.test(title)) {
      pending = null;
      current = null;
      return;
    }
    const day = pending.day.padStart(2, '0');
    current = {
      section,
      date: pending.year ? `${pending.year}-${pending.month}-${day}` : resolveDate(day, pending.month, period),
      title,
      detail: [],
      amount: amount[1] === '-' ? -value : value,
      raw: pending.raw,
    };
    sections[section].push(current);
    pending = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const next: SectionKey | null = ACCOUNT_SECTION_RE.test(line)
      ? 'cuenta'
      : CAJITAS_SECTION_RE.test(line)
        ? 'cajitas'
        : null;
    if (next) {
      section = next;
      pending = null;
      current = null;
      continue;
    }
    if (!section) continue;

    if (SECTION_END_RE.test(line)) {
      section = null;
      pending = null;
      current = null;
      continue;
    }
    if (FOOTER_ACCOUNT_RE.test(line)) {
      // The line before it is the customer name of the page footer, not movement detail
      const row = current as Row | null;
      if (row) {
        row.detail.pop();
        row.raw.pop();
      }
      pending = null;
      current = null;
      continue;
    }
    if (NOT_DETAIL_RE.test(line)) continue;

    const start = line.match(ROW_START_RE);
    const month = start ? monthNumber(start[2]) : undefined;
    if (start && month) {
      current = null;
      pending = { day: start[1], month, year: start[3], parts: [], raw: [line] };
      feedTitle(start[4]);
    } else if (pending) {
      pending.raw.push(line);
      feedTitle(line);
    } else if (current) {
      const row = current as Row;
      row.detail.push(line);
      row.raw.push(line);
    }
  }

  // Newest first in the statement -> chronological
  return [...sections.cuenta.reverse(), ...sections.cajitas.reverse()];
}

function isMirror(a: Row, b: Row): boolean {
  return a.section !== b.section && a.date === b.date && round2(a.amount + b.amount) === 0;
}

/**
 * Match each Cajita movement of the account with its mirror in the Cajitas table:
 * first rows with the same title, then any row that mentions a Cajita.
 */
function pairTransfers(rows: Row[]): void {
  const passes: Array<(a: Row, b: Row) => boolean> = [
    (a, b) => a.title === b.title,
    (a, b) => CAJITA_RE.test(a.title) || CAJITA_RE.test(b.title),
  ];
  for (const sameTransfer of passes) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].partner !== undefined) continue;
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[j].partner !== undefined || !isMirror(rows[i], rows[j]) || !sameTransfer(rows[i], rows[j])) continue;
        rows[i].partner = j;
        rows[j].partner = i;
        break;
      }
    }
  }
}

function buildTransactions(rows: Row[]): Transaction[] {
  const nextRowN = occurrenceCounter();
  const nextTransferN = occurrenceCounter();
  const transferN = new Map<number, number>(); // shared by both sides of a pair

  return rows.map((row, idx): Transaction => {
    const cents = toCents(row.amount);
    const tx: Transaction = {
      date: row.date,
      description: row.title,
      amount: row.amount,
      currency: 'MXN',
      type: row.amount < 0 ? 'debit' : 'credit',
      raw: row.raw.join(' '),
      account: NU_ACCOUNTS[row.section],
    };

    if (row.partner !== undefined) {
      const pairKey = Math.min(idx, row.partner);
      if (!transferN.has(pairKey)) {
        transferN.set(pairKey, nextTransferN(`${row.date}|${Math.abs(cents)}`));
      }
      tx.counterAccount = NU_ACCOUNTS[rows[row.partner].section];
      tx.externalId = `nu-xfer:${compactDate(row.date)}:${Math.abs(cents)}:${transferN.get(pairKey)}`;
    } else {
      tx.externalId = `nu-debito:${row.section}:${compactDate(row.date)}:${cents}:${nextRowN(`${row.section}|${row.date}|${cents}`)}`;
    }

    if (row.detail.length) {
      const detail = row.detail.join(' ').replace(/\s+/g, ' ').trim();
      tx.notes = detail;
      const bank = detail.match(SPEI_BANK_RE);
      const account = detail.match(SPEI_ACCOUNT_RE);
      if (bank && account) tx.payee = `${bank[1].trim()} ${account[1].slice(-4)}`;
    }
    const cardRow = row.section === 'cuenta' && row.partner === undefined ? row.title.match(CARD_ROW_RE) : null;
    if (cardRow && !tx.payee) tx.payee = cardRow[1];
    if (row.section === 'cuenta' && row.amount < 0 && CARD_PAYMENT_RE.test(row.title)) {
      tx.counterAccount = NU_ACCOUNTS.credito;
    }
    return tx;
  });
}

/** One row for the net interest of the period, which the statement only shows in its summary. */
function buildInterest(text: string, period: Period): Transaction | undefined {
  const m = text.match(INTEREST_RE);
  const amount = m ? parseMXAmount(m[1]) : 0;
  if (!(amount > 0)) return undefined;

  return {
    date: period.end,
    description: 'Dinero generado este mes',
    amount,
    currency: 'MXN',
    type: 'credit',
    raw: m![0],
    // Only the Cajitas earn interest: across consecutive statements their balance
    // grows by exactly this amount, while money left in the account earns nothing
    account: NU_ACCOUNTS.cajitas,
    payee: NU_PAYEE,
    category: 'Rendimientos',
    externalId: `nu-interes:${compactDate(period.end)}`,
  };
}
