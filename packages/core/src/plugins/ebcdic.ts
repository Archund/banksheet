/**
 * EBCDIC text decoding, shared by any plugin whose bank needs it.
 *
 * Some banks (e.g. HSBC Mexico) generate their PDFs on a mainframe and embed
 * fonts whose character codes are EBCDIC (code page 037) with no Unicode map.
 * The PDF renders fine, but the extracted text is unreadable: "PRODUCTO" comes
 * out as "×ÙÖÄäÃãÖ". Every character code is really an EBCDIC byte, so the
 * text can be recovered exactly.
 *
 * A plugin calls `normalizeEbcdic(text)` at the start of `detect` and `parse`:
 * encoded text is decoded, readable text is returned untouched.
 */

/** Unicode character for each EBCDIC (code page 037) byte, 16 per row. */
const CP037 =
  '\u0000\u0001\u0002\u0003\u009c\u0009\u0086\u007f\u0097\u008d\u008e\u000b\u000c\u000d\u000e\u000f' +
  '\u0010\u0011\u0012\u0013\u009d\u0085\u0008\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f' +
  '\u0080\u0081\u0082\u0083\u0084\u000a\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007' +
  '\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a' +
  '\u0020\u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2\u002e\u003c\u0028\u002b\u007c' +
  '\u0026\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df\u0021\u0024\u002a\u0029\u003b\u00ac' +
  '\u002d\u002f\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6\u002c\u0025\u005f\u003e\u003f' +
  '\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u0060\u003a\u0023\u0040\u0027\u003d\u0022' +
  '\u00d8\u0061\u0062\u0063\u0064\u0065\u0066\u0067\u0068\u0069\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1' +
  '\u00b0\u006a\u006b\u006c\u006d\u006e\u006f\u0070\u0071\u0072\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4' +
  '\u00b5\u007e\u0073\u0074\u0075\u0076\u0077\u0078\u0079\u007a\u00a1\u00bf\u00d0\u00dd\u00de\u00ae' +
  '\u005e\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be\u005b\u005d\u00af\u00a8\u00b4\u00d7' +
  '\u007b\u0041\u0042\u0043\u0044\u0045\u0046\u0047\u0048\u0049\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5' +
  '\u007d\u004a\u004b\u004c\u004d\u004e\u004f\u0050\u0051\u0052\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff' +
  '\u005c\u00f7\u0053\u0054\u0055\u0056\u0057\u0058\u0059\u005a\u00b2\u00d4\u00d6\u00d2\u00d3\u00d5' +
  '\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u00b3\u00db\u00dc\u00d9\u00da\u009f';

/** Marker inserted between pages by `extractText`; it is plain text, never EBCDIC. */
const PAGE_BREAK = '--- PAGE BREAK ---';

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * True when the text only makes sense as EBCDIC bytes: EBCDIC letters and digits
 * are all in 0x80-0xFF, where readable text has few characters (accents only).
 */
export function looksLikeEbcdic(text: string): boolean {
  let high = 0;
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x80 && code <= 0xff) high++;
    else if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      ascii++;
    }
  }
  return high > 50 && high > ascii * 2;
}

/**
 * Decode EBCDIC character codes into readable text. The spaces and line breaks
 * added by the PDF text extraction and the page-break marker lines are kept.
 */
export function decodeEbcdic(text: string): string {
  return text
    .split('\n')
    .map(line => {
      if (line.trim() === PAGE_BREAK) return line;
      let out = '';
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const code = line.charCodeAt(i);
        out += ch === ' ' || ch === '\t' || ch === '\r' || code > 0xff ? ch : CP037[code];
      }
      // Control codes left over from the decoding carry no text
      return out.replace(CONTROL_CHARS_RE, ' ');
    })
    .join('\n');
}

/** Decode the text when it is EBCDIC-encoded; return it unchanged otherwise. */
export function normalizeEbcdic(text: string): string {
  return looksLikeEbcdic(text) ? decodeEbcdic(text) : text;
}
