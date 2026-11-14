import { describe, expect, it } from "vitest";
import { BarcodeError, expandUpcE, hasValidCheckDigit, normalizeBarcode, sameGtin } from "../src/shared/gtin";

describe("barcode normalization", () => {
  it("preserves leading zeros in a UPC-A and maps it to GTIN-14", () => {
    const [b] = normalizeBarcode("077034085228");
    expect(b.format).toBe("upc_a");
    expect(b.input).toBe("077034085228");
    expect(b.gtin14).toBe("00077034085228");
    expect(b.queryForms).toEqual(["077034085228", "0077034085228", "00077034085228"]);
  });

  it("treats UPC-A, EAN-13 with a leading 0 and GTIN-14 as the same product", () => {
    const a = normalizeBarcode("077034085228")[0].gtin14;
    const b = normalizeBarcode("0077034085228")[0].gtin14;
    const c = normalizeBarcode("00077034085228")[0].gtin14;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("strips spaces and hyphens but rejects letters", () => {
    expect(normalizeBarcode("0 77034 08522 8")[0].gtin14).toBe("00077034085228");
    expect(() => normalizeBarcode("07703408522X")).toThrow(BarcodeError);
  });

  it("rejects a bad check digit", () => {
    expect(() => normalizeBarcode("077034085229")).toThrow(/check digit/);
    expect(() => normalizeBarcode("3017624010702")).toThrow(/check digit/);
  });

  it("rejects unsupported lengths", () => {
    expect(() => normalizeBarcode("12345")).toThrow(BarcodeError);
  });

  it("validates EAN-13 check digits", () => {
    expect(hasValidCheckDigit("3017624010701")).toBe(true); // Nutella
    expect(normalizeBarcode("3017624010701")[0]).toMatchObject({ format: "ean_13", gtin14: "03017624010701" });
  });

  it("expands UPC-E to UPC-A", () => {
    // Classic examples: 04252614 ↔ 042100005264, 01234565 ↔ 012345000065
    expect(expandUpcE("04252614")).toBe("042100005264");
    expect(expandUpcE("01234565")).toBe("012345000065");
    const forms = normalizeBarcode("04252614", "upc_e");
    expect(forms).toHaveLength(1);
    expect(forms[0].gtin14).toBe("00042100005264");
    expect(forms[0].queryForms).toContain("04252614");
  });

  it("uses the scanner's format hint for 8-digit codes and otherwise tries every valid reading", () => {
    // 96385074 is a valid EAN-8 and not a UPC-E (number system 9).
    expect(normalizeBarcode("96385074")).toHaveLength(1);
    expect(normalizeBarcode("96385074")[0]).toMatchObject({ format: "ean_8", gtin14: "00000096385074" });
    expect(() => normalizeBarcode("96385074", "upc_e")).toThrow(BarcodeError);
  });

  it("compares provider codes exactly after padding (never as numbers)", () => {
    expect(sameGtin("077034085228", "00077034085228")).toBe(true);
    expect(sameGtin("0077034085228", "00077034085228")).toBe(true);
    expect(sameGtin("77034085228", "00077034085228")).toBe(true); // provider dropped the zero; padding is equivalent
    expect(sameGtin("077034085235", "00077034085228")).toBe(false); // near miss
    expect(sameGtin(undefined, "00077034085228")).toBe(false);
  });
});
