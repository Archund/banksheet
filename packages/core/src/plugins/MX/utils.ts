/** Parse a Mexican-peso amount like "1,234.56" (comma thousands, dot decimal) into a number. */
export function parseMXAmount(raw: string): number {
  return parseFloat(raw.replace(/[$\s,]/g, ''));
}

/** Round to 2 decimals, avoiding float noise from balance arithmetic. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Amount in integer cents (avoids float noise in IDs). */
export function toCents(n: number): number {
  return Math.round(n * 100);
}

/** Compact ISO date for IDs: 2026-09-02 -> 20260902. */
export function compactDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/**
 * Returns a function that numbers repeated keys (1, 2, 3...) so lines that are
 * otherwise identical still get distinct IDs.
 */
export function occurrenceCounter(): (key: string) => number {
  const seen = new Map<string, number>();
  return (key: string) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n;
  };
}

/** Spanish month abbreviations → month number (01-12). Keys are lowercase. */
export const ES_MONTHS: Record<string, string> = {
  'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04',
  'may': '05', 'jun': '06', 'jul': '07', 'ago': '08',
  'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12',
};
