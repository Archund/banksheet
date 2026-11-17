# HSBC México — account statement (Estado de Cuenta)

## Detection markers
`HSBC` + `DETALLE MOVIMIENTOS`, checked on the decoded text (see below).

Tested with the "Producto Básico General" account. Other HSBC deposit accounts that print the same
"DETALLE MOVIMIENTOS <product> No. <account>" table should work, but are untested.

## EBCDIC-encoded text
HSBC generates these PDFs on a mainframe: the embedded fonts use EBCDIC (code page 037) character codes and
have no Unicode map. The PDF looks fine, but the extracted text is unreadable (`×ÙÖÄäÃãÖ` for `PRODUCTO`)
and nothing can be copied from a viewer.

`detect` and `parse` call `normalizeEbcdic` from [`plugins/ebcdic.ts`](../../ebcdic.ts) first, which decodes
the text when it is encoded and returns readable text unchanged. The decoder is a separate module so other
plugins can use it; nothing in the core extraction changes.

## Statement layout
- Page 1: summary ("RESUMEN DE CUENTAS"), the period (`Período del DD/MM/YYYY al DD/MM/YYYY`) and the
  movements table "DETALLE MOVIMIENTOS <product> No. <account number>", which continues on later pages.
- After the table: totals (`Otros Cargos`, `Saldo Inicial $`, `Saldo Final $`), then the detail tables
  "Información SPEI´s Enviados / Recibidos" and "Información CoDi® Enviados / Recibidos".

## PDF extraction quirks
- Rows only print the **day**; month and year come from the statement period (also for periods that span
  two months). Without a period nothing is parsed.
- The **Retiro/Cargo** and **Depósito/Abono** columns collapse into a single `$ amount`, followed by the
  balance. Direction is derived from the running balance, starting at `Saldo Inicial $ X` (printed *after*
  the table). Without a usable balance chain it falls back to keywords (`CGO`, `PAGO DE TARJETA`,
  `COMISIÓN`, `RETIRO`, `IVA`, `ISR` => expense). `PAGO DE NOMINA` is a deposit.
- A row is one line (`14 NOMINA   141125 19014622 $ 11,679.42  $ 16,121.97`) or wraps: description and
  reference, then the serial on its own line, then the amounts.
- Descriptions are padded with spaces; the padding is collapsed.
- The bank's own data drops some characters in free-text concepts (`Reembo so` for "Reembolso"). The
  statement's XML shows the same text; it is not a decoding error.

## Transaction fields
- `account`: `HSBC <product> <last 4 digits of the account number>`.
- `externalId`: `hsbc-debito:<last 4>:<date>:<balance in cents>:<n>`.
- `notes`: `Ref. <reference> / <serial>`, plus the transfer details when there are any.
- **Card payments** print the full card number (`PAGO DE TARJETA: <16 digits> EN BPI`); the description keeps
  the last 4 digits only (`****1234`). `raw` keeps the original line.
- **Transfers**: each entry of the SPEI / CoDi tables is paired with its movement and adds
  `payee` = `<BANK> <last 4 digits of the counterparty account>` and a note with bank, name, time and concept.
  - Sent transfers are paired by serial: the tracking key is `HSB`/`HSBC` + the movement's serial.
  - The rest are paired by amount and direction, closest date first (within 5 days): the tables can date a
    transfer a few days away from its movement.
  - Every column of those tables wraps on its own, so bank and name cannot always be told apart: `payee`
    uses the first word as the bank, and the note keeps the whole text.

## Validation
On 12 monthly statements (Nov 2025 – Oct 2026): deposits and withdrawals match the summary
("Depósitos/Abonos", "Retiros/Cargos"), the movements match the statement's XML (count, dates and amounts),
and every entry of the SPEI tables is paired with a movement.

## Known limitations
- Developed from decoded, redacted text of the statements; the encoded path is covered by tests that
  re-encode that text, not by PDFs in the test suite.
- CoDi tables were empty in the samples; they are read like the SPEI tables but are untested.
- Commissions, interest and cash withdrawals did not occur in the samples.
- Statements with more than one account are untested (the balance chain restarts at each new account number).
