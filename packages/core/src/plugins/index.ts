import type { BankParser } from '../types';
import { bradescoCartaoParser } from './BR/bradesco-cartao/index';
import { c6CartaoParser } from './BR/c6-cartao/index';
import { interCartaoParser } from './BR/inter-cartao/index';
import { itauCartaoParser } from './BR/itau-cartao/index';
import { nubankCartaoParser } from './BR/nubank-cartao/index';
import { portoSeguroCartaoParser } from './BR/porto-seguro-cartao/index';
import { pcFinancialMastercardParser } from './CA/pc-financial-mastercard/index';
import { chaseCreditParser } from './US/chase-credit/index';
import { hsbcDebitoParser } from './MX/hsbc-debito/index';

/** All registered bank parsers */
export const plugins: BankParser[] = [
  // HSBC goes first: its statements list transfer counterparties by bank name
  // ("NUBANK", "BANCO INTER"...), which the broader detectors below would match.
  hsbcDebitoParser,
  bradescoCartaoParser,
  c6CartaoParser,
  interCartaoParser,
  itauCartaoParser,
  nubankCartaoParser,
  portoSeguroCartaoParser,
  pcFinancialMastercardParser,
  chaseCreditParser,
];

export function getParserByName(name: string): BankParser | undefined {
  return plugins.find(p => p.name.toLowerCase() === name.toLowerCase());
}

export function listParsers(): Array<{ name: string; country: string }> {
  return plugins.map(p => ({ name: p.name, country: p.country }));
}
