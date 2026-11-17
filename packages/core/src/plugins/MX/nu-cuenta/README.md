# Nu México — Cuenta Nu (and Cajitas)

## Detection markers
`Nu México Financiera` + `Cuenta Nu`

A month without movements has no movement table at all, so detection relies on the issuer line of the
page footer and the account label. Nu México statements do not match the Brazilian `Nubank Cartão` parser.

## Statement layout
- Page 1: summary with the period (`Periodo: del 01 al 29 feb 2024`), `Saldo inicial`, `Depósitos`,
  `Gastos`, `Dinero generado este mes`, the closing balance and how it is split (`En su Cuenta`, `En Cajitas`).
- "Detalle de movimientos en tu cuenta": movements of the account.
- "Detalle de movimientos de tus cajitas": movements of the Cajitas (savings pockets).
- "DINERO GENERADO EN TU CUENTA NU": interest before tax, tax withheld and the net amount.

Both tables are missing when the month has no movements.

## PDF extraction quirks
- A row is `DD MMM <title> ±$amount` (`14 FEB Depósito en Cajita: Mi Primera Cajita -$15,000.00`). The sign
  is printed. The year comes from the period.
- Rows are listed **newest first**; they are returned in chronological order (account first, then Cajitas).
- A SPEI movement is followed by several wrapped detail lines (time, bank, sender, concept, account,
  tracking key, reference). They go to `notes`.
- Every page ends with a footer (customer name, `Cuenta Nu: <number>`, the bank's address, `N de M`). The
  name line looks like movement detail, so the line right before `Cuenta Nu:` is dropped.

## Transaction fields
- `account`: `Nu Cuenta` or `Nu Cajitas`. All Cajitas share one account; the Cajita's name stays in the description.
- **Cajita transfers** appear in both tables with opposite signs. Same-day mirrored rows are paired (same
  title first, then any row mentioning a Cajita): both sides get the same `externalId`
  (`nu-xfer:<date>:<amount>:<n>`) and each other's account as `counterAccount`, so an importer sees one transfer.
- Other rows: `externalId` = `nu-<cuenta|cajitas>:<date>:<amount in cents>:<n>`.
- **Payee**: for SPEI movements, `<BANK> <last 4 digits of the counterparty account>`.
- **Interest** is not printed as a movement. The net `Dinero generado este mes` becomes one row on the last
  day of the period (category `Rendimientos`, payee `Nu`, `externalId` `nu-interes:<date>`). The statement
  does not say which balance earned it: it is credited to `Nu Cajitas` when the Cajitas hold money at the
  end of the period, otherwise to `Nu Cuenta`. With money in both, that split is an approximation.

## Validation
On the sample statements the movements plus the interest row equal the change between `Saldo inicial` and
the closing balance.

## Known limitations
- Developed from two statements from early 2024: SPEI deposits, Cajita deposits and a month with no
  movements. **Not seen yet:** card purchases, SPEI sent (the `Enviado a ... A la cuenta ...` wording is a
  guess), Cajita withdrawals, commissions, tax withheld, and newer statement layouts.
- Only the Cuenta Nu statement is supported, not the Nu credit card.
