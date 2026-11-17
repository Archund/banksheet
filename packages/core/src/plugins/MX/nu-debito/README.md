# Nu México — Cuenta Nu (and Cajitas)

## Detection markers
Issuer line + `Cuenta Nu`. The issuer is `Nu México Financiera` (S.F.P.) until 2025 and
`Nubank, S.A., Institución de Banca Múltiple` since Nu became a bank.

A month without movements has no movement table at all, so detection relies on the issuer line of the
page footer and the account label. The newer issuer contains "Nubank", which the Brazilian `Nubank Cartão`
parser also matches, so this parser is registered before it.

## Statement layout
- Page 1: summary with the period (`Periodo: del 01 al 29 feb 2024`), `Saldo inicial`, `Depósitos`,
  `Gastos`, `Dinero generado este mes`, the closing balance and how it is split (`En su Cuenta`, and
  `En Cajitas` or, later, `Total Cajitas` with `Disponible 24/7` / `Congelado`).
- "Detalle de movimientos en tu cuenta": movements of the account.
- "Detalle de movimientos de tus cajitas": movements of the Cajitas (savings pockets).
- "DINERO GENERADO EN TU CUENTA NU": interest before tax, tax withheld and the net amount.

Both tables are missing when the month has no movements.

## PDF extraction quirks
- A row is `DD MMM <title> ±$amount` (`14 FEB Depósito en Cajita: Mi Primera Cajita -$15,000.00`) or, since
  mid-2024, `DD MMM YYYY <title> ±$amount`; the year can wrap to the next line. The sign is printed. A
  missing year comes from the period.
- Long titles wrap; the amount ends the last line.
- Rows are listed **newest first**; they are returned in chronological order (account first, then Cajitas).
- A SPEI movement (received or sent) is followed by several wrapped detail lines (time, bank, counterparty,
  concept, account, tracking key, reference). They go to `notes`.
- The table continues on the next page without repeating its header.
- Every page ends with a footer (customer name, `Cuenta Nu: <number>`, the bank's address, `N de M`). The
  name line looks like movement detail, so the line right before `Cuenta Nu:` is dropped.

## Transaction fields
- `account`: `Nu Débito` or `Nu Cajitas`. All Cajitas share one account; the Cajita's name stays in the description.
- **Freezing / unfreezing** (`Congelaste saldo hasta el ... en tu Cajita: X`, `Descongelamos saldo de tu
  Cajita: X`) moves money between "Disponible" and "Congelado" inside the Cajitas. The Cajitas total does
  not change, so these rows are skipped.
- **Cajita transfers** appear in both tables with opposite signs. Same-day mirrored rows are paired (same
  title first, then any row mentioning a Cajita): both sides get the same `externalId`
  (`nu-xfer:<date>:<amount>:<n>`) and each other's account as `counterAccount`, so an importer sees one transfer.
- Other rows: `externalId` = `nu-debito:<cuenta|cajitas>:<date>:<amount in cents>:<n>`.
- **Payee**: for SPEI movements, `<BANK> <last 4 digits of the counterparty account>`; for debit card rows
  (`<MERCHANT> Compra`, `<MERCHANT> Devolución`), the merchant.
- **Credit card payment** (`Pago a tu tarjeta de crédito Nu`): `counterAccount` = `Nu Tarjeta de Crédito`.
- **Interest** is not printed as a movement. The net `Dinero generado este mes` becomes one row on the last
  day of the period (category `Rendimientos`, payee `Nu`, `externalId` `nu-interes:<date>`), credited to
  `Nu Cajitas`: across consecutive statements the Cajitas balance grows by exactly that amount, while money
  left in the account earns nothing.

## Validation
On 33 consecutive monthly statements (Feb 2024 – Oct 2026):
- movements plus the interest row equal the change between `Saldo inicial` and the closing balance;
- per account, each month's rows take the previous statement's `En su Cuenta` / Cajitas balance exactly to
  the next one;
- every Cajita movement is paired with its mirror in the other table.

## Known limitations
What the parser does not account for, or could not be checked against a sample:

- **Interest is one row per month.** Nu credits it daily but only prints the monthly total, so the row is
  dated on the last day of the period. Tax withheld (`ISR`) was always `$0.00`; the net amount is used.
- **Cajitas are one account.** Individual Cajitas are not separate accounts, and frozen vs. available money
  is not tracked (freeze / unfreeze rows are skipped).
- **Links to other accounts.** Transfers to/from other banks are not linked to the matching row of another
  bank's statement. A payment to the Nu credit card gets a `counterAccount` but no shared `externalId`,
  because the credit card statement is not supported.
- **Movement detail across a page break:** the continuation lines are lost (only `notes` and, if the bank or
  account falls in the lost part, `payee` are affected; the movement itself is kept).
- **Card rows** are recognized by the `Compra` / `Devolución` suffix; a foreign-currency purchase was never
  seen, and no exchange rate is exported.
- **Never seen in a sample:** commissions, cash deposits or withdrawals, reversed movements, a period that is
  not a calendar month.
- **Not supported:** the Nu credit card statement. The currency is always `MXN`.
