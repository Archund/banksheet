# Nu México — Tarjeta de Crédito Nu

## Detection markers
Issuer (`Nubank, S.A. Institución de Banca Múltiple`, or the older `Nu México Financiera`) + `Tarjeta de Crédito Nu`
(product line) + the movement table title `CARGOS, ABONOS Y COMPRAS REGULARES`.

A card payment made from the Cuenta Nu prints `Abono (con cuenta Nu)`, which the `Nu Débito` detector also matches,
so this parser is registered before it. The issuer contains "Nubank", which the Brazilian `Nubank Cartão` parser
matches too; both Nu MX parsers are registered before it.

## Statement layout
- Page 1: summary with `Periodo: 26 SEP 2026 al 26 OCT 2026`, `Fecha de corte`, payment amounts, the period
  summary (`Adeudo del periodo anterior`, `Cargos regulares`, `Pagos y abonos`...) and credit usage.
- Page 2: interest calculation and the distribution of the last payment.
- Page 3: `DESGLOSE DE MOVIMIENTOS`: `COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES` (installment plans), when there are any.
- Page 4: `CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)`: every charge, payment and credit of the period, followed by
  the two totals (`+$1,399.90`, `-$500.00`) and the labels `Total de cargos` / `Total de abonos`.
- Pages 5–6: notes and glossary.

## PDF extraction quirks
- A row is `DD MMM YYYY DD MMM YYYY <description> | RFC: <merchant RFC> ±$amount`: operation date, posting date,
  description, the merchant's RFC (`S.I.` when unknown) and a signed amount. `+` is a charge, `-` a payment or credit.
- Lines under a row belong to it: `Abono (con cuenta Nu)` under a payment, and `Cambio (USD 1 = $18.50) USD 9.15`
  under a card purchase (the exchange rate and the amount in the original currency; also printed for MXN purchases).
- The totals are printed as bare amounts above their labels; they are skipped.
- Every page starts with `Número de tarjeta: XXXX-XXXX-XXXX-1234` and `Página N de M`; the table header and the
  cardholder line (`Tarjeta titular: ...`) can repeat when the table continues on the next page.

## Transaction fields
- `account`: `Nu Tarjeta de Crédito`. `amount`: charges negative, payments and credits positive.
- `date` = operation date; `bookingDate` = posting date when different.
- `exchangeRate` and `notes` (`USD 9.99`) from the `Cambio (...)` line. A merchant RFC other than `S.I.` goes to `notes`.
- `payee`: the merchant, i.e. the description without payment-processor prefixes (`Wl *`, `Tda `, `Recarga - `,
  `XXXX *`) and a trailing `Purchase`. The description itself is kept as printed.
- `externalId`: `nu-credito:<operation date>:<amount in cents>:<n>`.
- **Card payment from the Cuenta Nu** (`¡Gracias por tu pago!` + `Abono (con cuenta Nu)`): `counterAccount` =
  `Nu Débito` and `externalId` = `nu-debito:cuenta:<date>:<-amount in cents>:<n>`, the ID the `Nu Débito` parser gives
  the matching withdrawal (`Pago a tu tarjeta de crédito Nu`), so an importer records the transfer once. A payment
  from another bank stays a plain credit with a `nu-credito:` ID.

## Validation
On the two statements available (Sep and Oct 2026): charges and credits equal `Total de cargos` /
`Total de abonos`, and every row matches the hand-made CSVs imported before this parser existed (IDs included).
The payment IDs match the `Nu Débito` rows of the same days.

## Known limitations
What the parser does not account for, or could not be checked against a sample:

- **Installment plans** (`COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES` / `CON INTERESES`) are not parsed. The only
  sample is a 1/1 plan, whose purchase also appears in the regular table, so it is counted there. A real multi-month
  plan has not been seen: its monthly installments may not appear in the regular table.
- **Interest, fees and VAT** have not appeared in a sample (all zero). If charged, they are expected as regular rows.
- **Cash withdrawals**, **refunds** and **additional cards** (`Tarjeta adicional`) have not been seen.
- **Payment ID matching** assumes the payment shows the same date in both statements and that no two card payments
  of the same amount happen on the same day in a different order.
- The payee cleanup only knows the prefixes seen so far; other processors keep their prefix in `payee`.
