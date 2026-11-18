# Openbank México — Cuenta Débito Open + (and Apartado Open)

## Detection markers
`Openbank` + `Detalle de tus transacciones`

## Statement layout
One PDF holds **two independent accounts**, each with its own summary ("Resumen informativo": saldo
inicial, depósitos, otros cargos, saldo final, interés) followed by its own "Detalle de tus
transacciones":

| Section header      | Account                                              |
|---------------------|------------------------------------------------------|
| `Cuenta Débito Open +` | Debit account |
| `Apartado Open`     | Savings account that accrues the interest            |

The header repeats on every page, so only a *change* of header starts a new account. Each row carries
`account`, and `externalId` is unique per row.

## PDF extraction quirks
- The **Depósito** and **Retiro** columns collapse into a single `$ amount`; direction is derived from the
  running balance (`saldo - previous saldo`). The opening balance is the `Saldo inicial $ X` line of each
  account's summary. Without a usable balance chain it falls back to a keyword heuristic
  (`retiro|pago|cargo|comisión` => expense).
- A row starts with `DD/MM/YY`; the **concept may wrap over several lines** (SPEI transfers, "Retiro a
  Cuenta Débito Open +") and the `$ amount $ saldo` pair always ends the last line. Rows are assembled from
  the date line until that pair. A page break or a header drops an unfinished row.
- Concepts can carry alias text in braces (`Abono por promoción {Abono por promocion}`); the braces are removed.
- Some statements leave the concept blank. That still works.
- Two-digit years (`26` => 2026).

## What the parser adds
- **Internal transfers**: same-day, equal-and-opposite rows in the two accounts are paired. Both sides get the
  same description (`Transferencia de X a Y`), `counterAccount` and `externalId`, so an importer sees one transfer.
  When several rows mirror each other on the same day, the most certain pairs win: both concepts name the other
  account (`Retiro a Apartado Open` / `Abono desde Cuenta Débito Open +`), then one does, then neither (blank
  concepts).
- **Interest**: `Abono de intereses` (or, when the concept is blank, a small unlabeled Apartado deposit) gets
  category `Rendimientos`. A small unlabeled, unpaired Apartado withdrawal is a reversal of interest
  (`Reverso de intereses`), which is how the bank nets it in its own totals.
- **Card payments** (`Pago de tarjeta de crédito`) get the credit card as `counterAccount` and the
  `openbank-pago-tdc:...` `externalId` that the credit card statement gives the same payment (see
  `../openbank-common.ts`), so the payment is imported once even from two statements.
- **Payee**: SPEI transfers get the counterparty as `<BANK> <last 4 digits>`, the same in both directions
  (`enviada a <alias> 1234, BANCO, ...` and `recibida de la cuenta 1234 BANCO,...`); interest and promotions get
  `Openbank`. Map that payee to one of your own accounts in the importer to turn those rows into transfers.

## Verified
Per account, against each statement's own summary: closing balance = opening + rows, deposits (excl.
interest), withdrawals and interest all match.

## Known limitations
What the parser does not account for, or could not be checked against a sample:

- **Links to other banks.** Transfers to/from other banks (SPEI) stay as plain deposits/withdrawals with a
  payee (`<BANK> <last 4>`); they are not linked to the matching row of another bank's statement. The bank
  reference stays in the description because it wraps unpredictably.
- **Card payment link.** The shared `externalId` with the credit card statement uses this statement's date,
  which is the card statement's posting date; verified for weekday and weekend payments. A card payment
  printed with a blank concept is exported as a plain `Retiro` with its own ID and no counter account, so it
  does not link (seen once, July 2026); the card statement's payment row then duplicates it in an importer.
- **Unlabeled interest is a guess.** With a blank concept, an unpaired Apartado deposit or withdrawal of up to
  0.2% of the balance is treated as interest or its reversal. A real movement that small would be mislabeled.
- **Blank concepts.** Rows without a concept and without a transfer partner are exported as `Depósito` /
  `Retiro`, with no payee.
- **Card purchases, refunds and cash withdrawals** are plain rows: no payee, trailing empty fields stay in
  the description (`..., -, -`), and the exchange rate of a foreign cash withdrawal stays in the description
  instead of `exchangeRate`.
- **Not parsed:** the `Apartados a plazo fijo` and `Comisiones` tables (empty in every sample).
- **Never seen in a sample:** commissions, tax withheld on interest (`Impuestos retenidos` was always
  `$ 0.00`), more than one Apartado, a statement with a single account.
- **Direction without balances.** If the balance chain breaks, direction falls back to keywords
  (`retiro|pago|cargo|comisión` => expense); anything else is taken as a deposit.
