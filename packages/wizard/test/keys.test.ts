import { describe, expect, it } from "bun:test";
import { isPlaceholderKey, normalizeKey, placeholderKey, validateKey } from "../lib/keys";
import { PRODUCTS, PRODUCT_IDS } from "../lib/products";

const VALID_PUBLISHER_KEY = "spk_1234567890abcdef1234567890abcd";
const VALID_ADVERTISER_KEY = "adv_1234567890abcdef1234567890abcd";

describe("normalizeKey", () => {
  it("trims whitespace and stray quotes from a pasted key", () => {
    expect(normalizeKey(`  "${VALID_PUBLISHER_KEY}"  `)).toBe(VALID_PUBLISHER_KEY);
    expect(normalizeKey(`'${VALID_ADVERTISER_KEY}'`)).toBe(VALID_ADVERTISER_KEY);
  });
});

describe("validateKey", () => {
  it("accepts the documented publisher and advertiser key shapes", () => {
    expect(validateKey("publisher", VALID_PUBLISHER_KEY).valid).toBe(true);
    expect(validateKey("advertiser", VALID_ADVERTISER_KEY).valid).toBe(true);
  });

  it("matches the SDKs' own rule: right prefix, exactly 34 characters", () => {
    expect(PRODUCTS.publisher.keyLength).toBe(34);
    expect(PRODUCTS.advertiser.keyLength).toBe(34);
    expect(VALID_PUBLISHER_KEY.length).toBe(34);
    expect(VALID_ADVERTISER_KEY.length).toBe(34);
  });

  it("rejects the other product's key", () => {
    expect(validateKey("publisher", VALID_ADVERTISER_KEY).valid).toBe(false);
    expect(validateKey("advertiser", VALID_PUBLISHER_KEY).valid).toBe(false);
  });

  it("rejects a key of the wrong length and says what the length was", () => {
    const short = validateKey("publisher", "spk_tooshort");
    expect(short.valid).toBe(false);
    expect(short.reason).toContain("34");
    expect(short.reason).toContain("12");

    expect(validateKey("publisher", `${VALID_PUBLISHER_KEY}x`).valid).toBe(false);
  });

  it("rejects an empty key with a reason", () => {
    const result = validateKey("advertiser", "");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("property key");
  });
});

describe("placeholders", () => {
  it("produces a placeholder that passes the product's own validation", () => {
    for (const product of PRODUCT_IDS) {
      const placeholder = placeholderKey(product);
      expect(validateKey(product, placeholder).valid).toBe(true);
    }
  });

  it("recognises its own placeholders and nothing else", () => {
    expect(isPlaceholderKey(placeholderKey("publisher"))).toBe(true);
    expect(isPlaceholderKey(placeholderKey("advertiser"))).toBe(true);
    expect(isPlaceholderKey(VALID_PUBLISHER_KEY)).toBe(false);
  });

  it("makes the placeholder obviously fake to a human reading the diff", () => {
    expect(placeholderKey("publisher")).toContain("YOUR");
    expect(placeholderKey("advertiser")).toContain("YOUR");
  });
});
