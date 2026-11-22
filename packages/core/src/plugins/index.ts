import type { BankParser } from '../types';
import { bradescoCartaoParser } from './BR/bradesco-cartao/index';
import { c6CartaoParser } from './BR/c6-cartao/index';
import { interCartaoParser } from './BR/inter-cartao/index';
import { itauCartaoParser } from './BR/itau-cartao/index';
import { nubankCartaoParser } from './BR/nubank-cartao/index';
import { portoSeguroCartaoParser } from './BR/porto-seguro-cartao/index';
import { pcFinancialMastercardParser } from './CA/pc-financial-mastercard/index';
import { chaseCreditParser } from './US/chase-credit/index';
import { nuCreditoParser } from './MX/nu-credito/index';
import { nuDebitoParser } from './MX/nu-debito/index';

/** All registered bank parsers */
export const plugins: BankParser[] = [
  // Nu goes first: its statements name the banks of transfer counterparties
  // ("NUBANK", "BANCO INTER"...), which the broader detectors below would match.
  // Nu Crédito before Nu Débito: a card payment from the account prints "con cuenta Nu".
  nuCreditoParser,
  nuDebitoParser,
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
