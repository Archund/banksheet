import type { BankParser, Transaction } from '../../../types';
import { normalizeEbcdic } from '../../ebcdic';
import { compactDate, occurrenceCounter, parseMXAmount, round2, toCents } from '../utils';

// Hoisted regexes — compiled once at module load

// "DETALLE MOVIMIENTOS <product> No.  <account number>" opens the movements table (repeats on every page)
const DETAIL_RE = /^DETALLE MOVIMIENTOS\s+(.+?)\s+No\.\s*(\d+)\s*$/;
// The table ends with the totals; the SPEI / CoDi detail tables follow
const DETAIL_END_RE = /^(Otros Cargos|Saldo Final|Saldo Inicial|Comisiones|Retiro en Efectivo)\b/;
// A movement starts with the day of the month; reference, serial and amounts may wrap:
//   "14 NOMINA        141125 19014622 $ 11,679.42  $ 16,121.97"        (one line)
//   "03 CGO Transferencia SPEI 08045219" / "5054595" / "$ 694.00  $ 4,442.55"
// The Retiro / Depósito columns collapse into ONE amount, followed by the balance.
const ROW_START_RE = /^(\d{2})\s+(\S.*)$/;
const AMOUNTS_TAIL_RE = /(?:^|\s)\$\s*([\d,]+\.\d{2})\s+\$\s*([\d,]+\.\d{2})\s*$/;
const REFERENCE_TAIL_RE = /^(.*\S)\s+(\d{6,10})$/;
const SERIAL_RE = /^\d+$/;
const NOT_CONTINUATION_RE = /^(---|Día\b|Serial\b|CoDi\b|PAG\.|Estado de Cuenta)/;
const MAX_ROW_LINES = 6;

const PERIOD_RE = /per[ií]odo del (\d{2})\/(\d{2})\/(\d{4}) al (\d{2})\/(\d{2})\/(\d{4})/i;
const OPENING_RE = /Saldo Inicial \$\s*([\d,]+\.\d{2})/;
const OPENING_SUMMARY_RE = /Saldo Inicial del\s+Periodo\s+\$\s*([\d,]+\.\d{2})/;

// Used only when the balance chain is unavailable ("PAGO DE NOMINA" is a deposit, so no bare "PAGO")
const WITHDRAWAL_HINT_RE = /^(CGO|PAGO DE TARJETA|COMISI[OÓ]N|RETIRO|IVA|ISR)\b/i;
// Card payments print the full card number: keep the last 4 digits only
const CARD_NUMBER_RE = /\b\d{12}(\d{4})\b/g;

// "Información SPEI´s Enviados / Recibidos durante el periodo..." (and the CoDi® twins)
const TRANSFER_SECTION_RE = /^Informaci[oó]n\s+(?:SPEI|CoDi)\S*\s+(Enviados|Recibidos)\b/;
const TRANSFER_SECTION_END_RE = /^(\* Dato no verificado|CoDi:|Aclaraciones\b|Promociones\b|Mensajes\b)/;
// One transfer; every column wraps on its own, so the lines are joined before matching:
//   "01/12/2025 05:37:15 *BANCO Nombre" / "Beneficiario" / "00012345678901234567 Concepto" / "$ 1,990.49 HSB59073" ...
const TRANSFER_START_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})\s*(.*)$/;
const TRANSFER_RE = /^\*?(\S+)\s*(.*?)\s*(\d{18,20})\s*(.*?)\s*\$\s*([\d,]+\.\d{2})(?:\s+(.*))?$/;
// Tracking key of a transfer sent from the account: "HSB" / "HSBC" + the movement's serial.
// It wraps ("HSB50010" / "01") and is followed by a column of twelve zeros.
const OWN_TRACKING_RE = /^HSBC?(\d+)$/;
const TRACKING_END_RE = /^0{12}$/;
const MAX_TRANSFER_LINES = 14;
// The transfer tables can date a transfer a few days away from its movement
const MAX_TRANSFER_DAY_GAP = 5;

interface Period {
  start: string; // ISO
  end: string;
}

interface Row {
  product: string;
  accountNumber: string;
  date: string;
  description: string;
  reference?: string;
  serial?: string;
  amount: number;
  balance: number;
  raw: string;
}

interface Transfer {
  direction: 'sent' | 'received';
  date: string;
  time: string;
  bank: string;
  name: string;
  account: string;
  concept: string;
  amount: number;
  serial?: string; // sent transfers only: serial of the movement
}

export const hsbcDebitoParser: BankParser = {
  name: 'HSBC Débito',
  country: 'MX',

  detect(text: string): boolean {
    const readable = normalizeEbcdic(text);
    return /HSBC/.test(readable) && /DETALLE MOVIMIENTOS/.test(readable);
  },

  /**
   * HSBC Mexico PDFs carry EBCDIC-encoded text, so the text is decoded first
   * (see plugins/ebcdic.ts); already readable text is parsed as is.
   *
   * Movements come from the "DETALLE MOVIMIENTOS" table:
   * - rows only print the day; month and year come from the statement period;
   * - deposits and withdrawals share one amount column, so the direction is
   *   derived from the running balance, starting at "Saldo Inicial";
   * - the reference and serial go to `notes`, not the description.
   *
   * The "SPEI´s Enviados / Recibidos" tables that follow describe the same
   * transfers in more detail. Each one is matched to its movement (by serial,
   * or by amount, direction and closest date) and adds the counterparty as `payee`
   * ("<BANK> <last 4 digits>") and the transfer details to `notes`.
   */
  parse(text: string): Transaction[] {
    const readable = normalizeEbcdic(text);
    const period = findPeriod(readable);
    if (!period) return [];

    const rows = collectRows(readable, period);
    const transfers = collectTransfers(readable);
    return buildTransactions(rows, transfers);
  },
};

function findPeriod(text: string): Period | undefined {
  const m = text.match(PERIOD_RE);
  if (!m) return undefined;
  return { start: `${m[3]}-${m[2]}-${m[1]}`, end: `${m[6]}-${m[5]}-${m[4]}` };
}

/** Full date for a day of the month: the month of the period in which that day falls. */
function resolveDate(day: string, period: Period): string {
  let year = Number(period.start.slice(0, 4));
  let month = Number(period.start.slice(5, 7));
  const endKey = period.end.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const date = `${key}-${day}`;
    if ((date >= period.start && date <= period.end) || key >= endKey) return date;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
}

function findOpeningBalance(text: string): number | null {
  const m = text.match(OPENING_RE) ?? text.match(OPENING_SUMMARY_RE);
  return m ? parseMXAmount(m[1]) : null;
}

function collectRows(text: string, period: Period): Row[] {
  const rows: Row[] = [];
  let inDetail = false;
  let product = '';
  let accountNumber = '';
  let prevBalance = findOpeningBalance(text);

  // Row being assembled across lines
  let pending: { day: string; description: string; reference?: string; serial?: string; lines: string[] } | null =
    null;

  const feed = (fragment: string, first: boolean): void => {
    if (!pending) return;
    const amounts = fragment.match(AMOUNTS_TAIL_RE);
    const body = (amounts ? fragment.slice(0, amounts.index) : fragment).trim();

    if (body) {
      if (first) {
        const ref = body.match(REFERENCE_TAIL_RE);
        pending.description = ref ? ref[1] : body;
        pending.reference = ref?.[2];
      } else if (SERIAL_RE.test(body) && pending.serial === undefined) {
        pending.serial = body;
      } else {
        pending.description += ` ${body}`;
      }
    }
    if (!amounts) {
      if (pending.lines.length >= MAX_ROW_LINES) pending = null; // not a real row
      return;
    }

    const printed = parseMXAmount(amounts[1]);
    const balance = parseMXAmount(amounts[2]);
    const description = pending.description.replace(/\s+/g, ' ').trim();

    let amount: number;
    if (prevBalance !== null && round2(Math.abs(balance - prevBalance)) === printed) {
      amount = round2(balance - prevBalance);
    } else {
      // Fallback when the balance chain is unavailable or inconsistent
      amount = WITHDRAWAL_HINT_RE.test(description) ? -printed : printed;
    }

    rows.push({
      product,
      accountNumber,
      date: resolveDate(pending.day, period),
      description,
      reference: pending.reference,
      serial: pending.serial,
      amount,
      balance,
      raw: pending.lines.join(' ').replace(/\s+/g, ' '),
    });
    prevBalance = balance;
    pending = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const detail = line.match(DETAIL_RE);
    if (detail) {
      pending = null;
      inDetail = true;
      // The header repeats on every page: only another account breaks the balance chain
      if (accountNumber && detail[2] !== accountNumber) prevBalance = null;
      product = detail[1];
      accountNumber = detail[2];
      continue;
    }
    if (!inDetail) continue;

    if (DETAIL_END_RE.test(line) || TRANSFER_SECTION_RE.test(line)) {
      pending = null;
      inDetail = false;
      continue;
    }

    const start = line.match(ROW_START_RE);
    if (start && Number(start[1]) >= 1 && Number(start[1]) <= 31) {
      pending = { day: start[1], description: '', lines: [line] };
      feed(start[2], true);
      continue;
    }

    if (pending) {
      if (NOT_CONTINUATION_RE.test(line)) {
        pending = null;
      } else {
        pending.lines.push(line);
        feed(line, false);
      }
    }
  }

  return rows;
}

function collectTransfers(text: string): Transfer[] {
  const transfers: Transfer[] = [];
  let direction: Transfer['direction'] | null = null;
  let pending: { date: string; time: string; parts: string[] } | null = null;

  const finish = (): void => {
    if (!pending || !direction) return;
    const m = pending.parts.join(' ').replace(/\s+/g, ' ').trim().match(TRANSFER_RE);
    if (m) {
      transfers.push({
        direction,
        date: pending.date,
        time: pending.time,
        bank: m[1],
        name: m[2],
        account: m[3],
        concept: m[4],
        amount: parseMXAmount(m[5]),
        serial: trackingSerial(m[6] ?? ''),
      });
    }
    pending = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const section = line.match(TRANSFER_SECTION_RE);
    if (section) {
      finish();
      direction = section[1] === 'Enviados' ? 'sent' : 'received';
      continue;
    }
    if (!direction) continue;

    if (TRANSFER_SECTION_END_RE.test(line) || DETAIL_RE.test(line)) {
      finish();
      direction = null;
      continue;
    }
    if (line.startsWith('---')) {
      finish(); // a page break ends the transfer, not the table
      continue;
    }

    const start = line.match(TRANSFER_START_RE);
    if (start) {
      finish();
      pending = { date: `${start[3]}-${start[2]}-${start[1]}`, time: start[4], parts: [start[5]] };
    } else if (pending) {
      pending.parts.push(line);
      if (pending.parts.length > MAX_TRANSFER_LINES) pending = null; // not a real transfer
    }
  }
  finish();

  return transfers;
}

/** Serial of the movement, taken from the tracking key printed after the amount. */
function trackingSerial(rest: string): string | undefined {
  const tokens = rest.split(' ').filter(Boolean);
  const end = tokens.findIndex(t => TRACKING_END_RE.test(t));
  if (end <= 0) return undefined;
  return tokens.slice(0, end).join('').match(OWN_TRACKING_RE)?.[1];
}

function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * Pair each transfer of the SPEI / CoDi tables with its movement. Sent transfers
 * carry the movement's serial in their tracking key; the rest are paired by
 * amount and direction, taking the closest date first.
 */
function matchTransfers(rows: Row[], transfers: Transfer[]): Map<number, Transfer> {
  const matched = new Map<number, Transfer>();
  const used = new Set<Transfer>();
  const fits = (row: Row, t: Transfer): boolean =>
    !used.has(t) &&
    t.direction === (row.amount < 0 ? 'sent' : 'received') &&
    toCents(t.amount) === toCents(Math.abs(row.amount)) &&
    dayGap(row.date, t.date) <= MAX_TRANSFER_DAY_GAP;
  const pair = (idx: number, t: Transfer | undefined): void => {
    if (!t) return;
    matched.set(idx, t);
    used.add(t);
  };

  rows.forEach((row, idx) => {
    if (row.serial) pair(idx, transfers.find(t => fits(row, t) && t.serial === row.serial));
  });
  rows.forEach((row, idx) => {
    if (matched.has(idx)) return;
    const candidates = transfers.filter(t => fits(row, t));
    candidates.sort((a, b) => dayGap(row.date, a.date) - dayGap(row.date, b.date));
    pair(idx, candidates[0]);
  });
  return matched;
}

function buildTransactions(rows: Row[], transfers: Transfer[]): Transaction[] {
  const matched = matchTransfers(rows, transfers);
  const nextRowN = occurrenceCounter();

  return rows.map((row, idx): Transaction => {
    const last4 = row.accountNumber.slice(-4);
    const cents = toCents(row.balance);
    const notes: string[] = [];
    if (row.reference) notes.push(`Ref. ${row.reference}${row.serial ? ` / ${row.serial}` : ''}`);

    const tx: Transaction = {
      date: row.date,
      description: row.description.replace(CARD_NUMBER_RE, '****$1'),
      amount: row.amount,
      currency: 'MXN',
      type: row.amount < 0 ? 'debit' : 'credit',
      raw: row.raw,
      account: `HSBC ${row.product} ${last4}`,
      externalId: `hsbc-debito:${last4}:${compactDate(row.date)}:${cents}:${nextRowN(`${last4}|${row.date}|${cents}`)}`,
    };

    const transfer = matched.get(idx);
    if (transfer) {
      const accountLast4 = transfer.account.slice(-4);
      tx.payee = `${transfer.bank} ${accountLast4}`;
      const who = [transfer.bank, transfer.name].filter(Boolean).join(' ');
      notes.push(
        `SPEI ${transfer.direction === 'sent' ? 'enviado a' : 'recibido de'} ${who}, cuenta ${accountLast4}, ${transfer.time}` +
          (transfer.concept ? `; concepto: ${transfer.concept}` : ''),
      );
    }
    if (notes.length) tx.notes = notes.join('; ');
    return tx;
  });
}
