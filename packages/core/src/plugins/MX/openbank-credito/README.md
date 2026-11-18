# Openbank México — Tarjeta de Crédito Open

## Detection markers
`Openbank` + `CARGOS, ABONOS Y COMPRAS REGULARES`

## Sections parsed ("DESGLOSE DE MOVIMIENTOS")
### Regular movements — `CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)`
- Row: `DD-MM-YYYY DD-MM-YYYY descripción <+|-> $ monto` (fecha de operación, fecha de cargo, ...).
  Long descriptions wrap over several lines; the sign + amount always ends the last one.
- `-` is a charge, `+` is a payment/refund => charges are negative. `date` is the operation date and
  `bookingDate` the posting date.
- Empty trailing fields are printed as `, -` (sometimes repeated) and are stripped.
- Foreign purchases: the rate is read from `, por -, tipo de cambio N` or `, -, $ N` into `exchangeRate`
  and removed from the description (the raw line keeps it).

### Installments without interest — `COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES`
- Row: `fecha descripción $ monto original $ saldo pendiente $ pago requerido NNN tasa %`.
- The purchase appears **only** here, once per month, and the summary line "Cargos compras a meses
  (capital)" is the sum of the monthly `pago requerido`. So each month yields one charge of
  `pago requerido`, dated at the statement's **fecha de corte** (falls back to the purchase date if the
  cut-off is missing), described as `... (MSI n/N)` (N = original / payment). The purchase date, original
  amount and remaining balance go to `notes`. Change the `date` assignment in `finishMsi` if you prefer the
  purchase date instead.
- `externalId` = purchase date + original amount + installment number, so every month is distinct and stable.
- **Converted after posting.** A purchase deferred to MSI after it was charged keeps its regular row, and the
  statement credits the original amount back without listing it: the credit only shows in `Total abonos`. When
  `Total abonos` minus the listed credits equals the original amounts of exactly one set of first installments
  (`001`), the parser adds one credit per plan, `... (conversión a MSI)`, dated at the cut-off, with ID
  `openbank-credito-msi-conversion:<purchase date>:<original cents>:1`.

## What the parser adds
- **Payee**: the merchant, i.e. the text after `Compra [con Google/Apple Pay] [en línea] en` /
  `Devolución de compra en` up to the first comma (city and country follow). Top-ups (`Recarga <operador> de
  $...`) get the carrier, promotions get `Openbank`. Rows with no recognisable merchant have no payee.
- **Card payments** (`Pago de tarjeta de crédito`) are a transfer from the debit account: `counterAccount` is
  the debit account and the `externalId` is `openbank-pago-tdc:<posting date>:<amount>:<n>`, the same ID the debit
  statement gives the withdrawal, so an importer that deduplicates on external ID records it once.

## Verified
`sum(charges) = Total cargos` (regular + installments) and `sum(payments/refunds) = Total abonos`, and the
installment sum equals "Cargos compras a meses (capital)", on every sample statement.

## Known limitations
What the parser does not account for, or could not be checked against a sample:

- **Anything with interest.** No sample statement had interest charged, so:
  - `COMPRAS Y CARGOS DIFERIDOS A MESES CON INTERESES` (installments with interest) are skipped, not parsed;
  - months where interest, fees or IVA are charged are untested. In the samples these only appear (as
    `$ 0.00`) in summary boxes, not as movement rows; if a statement prints them as regular movements they
    are parsed like any other row, otherwise they are missing from the output.
- **Card payment link.** It assumes the payment is made from the Openbank debit account. The shared ID uses
  the card statement's posting date (fecha de cargo), which is the date the debit statement prints; verified
  for weekday and weekend payments (paid Saturday, posted Monday). It fails when the debit statement labels
  the payment only as a blank-concept `Retiro` (seen once, July 2026): the debit row then has its own ID and
  no counter account, and the payment is recorded twice unless the debit-side withdrawal is removed or paired
  in a separate step. A payment from another bank labeled the same way would be linked
  to the debit account too (fix `counterAccount` in the importer if so).
- **Installments are monthly charges, not purchases.** The purchase itself is never exported as one row; each
  month adds the required payment, dated at the cut-off date. The total number of installments is derived
  (`original / payment`, rounded). Early settlement or a cancelled plan is untested.
- **Conversion credits are inferred, not read.** They are added only when the unlisted part of `Total abonos`
  matches the originals of one unique set of first installments; any other unlisted credit (or an ambiguous
  match) is left out, and the month will not reconcile until it is entered by hand. Verified on one sample
  (a foreign purchase whose regular charge and credit-back differ by the exchange-rate difference).
- **Foreign purchases:** the statement prints only the exchange rate, not the original amount or currency
  (`por -`), so neither is exported.
- **Additional cards.** The "Tarjeta adicional" tables were empty in the samples; their rows would be parsed
  but not told apart from the main card.
- **Not parsed:** `INFORMACIÓN DE OTRAS LÍNEAS DE CRÉDITO`, `CARGOS NO RECONOCIDOS`, the payment
  distribution and summary boxes.
- **Never seen in a sample:** cash advances, balance transfers, late-payment or annual fees, a credit
  balance in favor.
