// Barcode (GTIN) normalization.
//
// Barcodes are always handled as digit STRINGS so leading zeros survive.
// Equivalent formats are compared through a zero-padded GTIN-14:
//   UPC-A 012345678905  ==  EAN-13 0012345678905  ==  GTIN-14 00012345678905
// UPC-E is expanded to UPC-A first. EAN-8 is padded to GTIN-14 too, but an
// EAN-8 never equals a UPC-A/EAN-13 product because it pads differently.

export type BarcodeFormat = "upc_a" | "upc_e" | "ean_13" | "ean_8" | "gtin_14";

export interface NormalizedBarcode {
  /** The digits as entered or scanned (leading zeros preserved). */
  input: string;
  format: BarcodeFormat;
  /** Canonical 14-digit form used for exact equality. */
  gtin14: string;
  /** Forms to try against providers, most specific first, de-duplicated. */
  queryForms: string[];
}

export class BarcodeError extends Error {}

/** GS1 mod-10 check digit for the payload (all digits except the check digit). */
export function gs1CheckDigit(payload: string): number {
  let sum = 0;
  // Weights alternate 3,1,3,... starting from the rightmost payload digit.
  for (let i = 0; i < payload.length; i++) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d{2,}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Expand an 8-digit UPC-E (number system 0 or 1) to a 12-digit UPC-A. Returns null if invalid. */
export function expandUpcE(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const ns = upce[0];
  const d = upce.slice(1, 7);
  const check = upce[7];
  const last = d[5];
  let body: string;
  switch (last) {
    case "0":
    case "1":
    case "2":
      body = d[0] + d[1] + last + "0000" + d[2] + d[3] + d[4];
      break;
    case "3":
      body = d[0] + d[1] + d[2] + "00000" + d[3] + d[4];
      break;
    case "4":
      body = d[0] + d[1] + d[2] + d[3] + "00000" + d[4];
      break;
    default:
      body = d[0] + d[1] + d[2] + d[3] + d[4] + "0000" + last;
  }
  const upca = ns + body + check;
  return hasValidCheckDigit(upca) ? upca : null;
}

function formsFromGtin14(gtin14: string): string[] {
  const forms: string[] = [];
  if (gtin14.startsWith("000000")) forms.push(gtin14.slice(6)); // EAN-8
  if (gtin14.startsWith("00")) forms.push(gtin14.slice(2)); // UPC-A (12)
  if (gtin14.startsWith("0")) forms.push(gtin14.slice(1)); // EAN-13
  forms.push(gtin14);
  return [...new Set(forms)];
}

function build(input: string, format: BarcodeFormat, canonical: string): NormalizedBarcode {
  const gtin14 = canonical.padStart(14, "0");
  // Put the as-entered representation first so providers see what the user typed.
  const forms = formsFromGtin14(gtin14);
  const ordered = format === "ean_8" ? forms : forms.filter((f) => f.length >= 12);
  // A provider might store a UPC-E product under its 8-digit code; try that too.
  if (format === "upc_e") ordered.push(input);
  return { input, format, gtin14, queryForms: [...new Set(ordered)] };
}

/**
 * Normalize a typed or scanned barcode. `hint` is the format reported by the
 * scanner, if any; it disambiguates 8-digit EAN-8 vs UPC-E.
 * Returns all valid interpretations (normally one).
 */
export function normalizeBarcode(raw: string, hint?: string): NormalizedBarcode[] {
  const input = String(raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(input)) throw new BarcodeError("Barcodes may contain digits only.");
  switch (input.length) {
    case 8: {
      const results: NormalizedBarcode[] = [];
      const asUpcE = expandUpcE(input);
      const asEan8 = hasValidCheckDigit(input);
      const upcE = asUpcE ? build(input, "upc_e", asUpcE) : null;
      const ean8 = asEan8 ? build(input, "ean_8", input) : null;
      if (hint === "upc_e") {
        if (upcE) results.push(upcE);
      } else if (hint === "ean_8") {
        if (ean8) results.push(ean8);
      } else {
        if (ean8) results.push(ean8);
        if (upcE) results.push(upcE);
      }
      if (!results.length) throw new BarcodeError("That 8-digit code is not a valid EAN-8 or UPC-E barcode (check digit mismatch).");
      return results;
    }
    case 12:
      if (!hasValidCheckDigit(input)) throw new BarcodeError("That UPC-A barcode has an invalid check digit. Please re-check the digits.");
      return [build(input, "upc_a", input)];
    case 13:
      if (!hasValidCheckDigit(input)) throw new BarcodeError("That EAN-13 barcode has an invalid check digit. Please re-check the digits.");
      return [build(input, "ean_13", input)];
    case 14:
      if (!hasValidCheckDigit(input)) throw new BarcodeError("That GTIN-14 has an invalid check digit. Please re-check the digits.");
      return [build(input, "gtin_14", input)];
    default:
      throw new BarcodeError("Enter an 8, 12, 13 or 14 digit barcode (UPC-A, UPC-E, EAN-13, EAN-8).");
  }
}

/** Exact GTIN equality after safe normalization. Returns false for unparsable codes. */
export function sameGtin(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const digits = a.replace(/\D/g, "");
  if (!digits || digits.length > 14) return false;
  // Provider codes are stored as UPC-A/EAN-13/GTIN-14 strings; pad, don't parse as a number.
  if (digits.length === 8) {
    // Could be EAN-8 or UPC-E as stored by a provider; accept either reading.
    const upca = expandUpcE(digits);
    if (upca && upca.padStart(14, "0") === b) return true;
  }
  return digits.padStart(14, "0") === b;
}
