/**
 * Key validation, mirroring the checks the SDKs themselves run at construction
 * time so the wizard rejects a bad key before an agent ever writes it into the
 * developer's source tree.
 */

import { PRODUCTS, type ProductId } from "./products";

export interface KeyCheck {
  /** Human-readable reason, present only when `valid` is false. */
  reason?: string;
  valid: boolean;
}

/**
 * Trim a key pasted from a dashboard: surrounding whitespace and the quotes a
 * copy-paste sometimes drags along.
 *
 * @param raw - Whatever the user typed or passed on the command line
 * @returns The cleaned key
 */
export function normalizeKey(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

/**
 * Validate a key against the product's documented format.
 *
 * The rule is deliberately identical to the SDKs': the right prefix and an
 * exact total length. Anything looser would let the wizard bake a key into a
 * codebase that the SDK then throws on at runtime.
 *
 * @param product - Which SDK the key belongs to
 * @param key - Key to check, already normalized
 * @returns Whether the key is usable, and why not when it isn't
 */
export function validateKey(product: ProductId, key: string): KeyCheck {
  const spec = PRODUCTS[product];

  if (!key) {
    return { reason: `A ${spec.keyLabel} is required.`, valid: false };
  }
  if (!key.startsWith(spec.keyPrefix)) {
    return { reason: `A ${spec.keyLabel} starts with "${spec.keyPrefix}".`, valid: false };
  }
  if (key.length !== spec.keyLength) {
    return {
      reason: `A ${spec.keyLabel} is exactly ${spec.keyLength} characters; this one is ${key.length}.`,
      valid: false,
    };
  }
  return { valid: true };
}

/**
 * The stand-in written into the integration when the user skips the key.
 *
 * It is deliberately shaped like a real key (right prefix, right length) so the
 * agent has no reason to "fix" it, and obviously fake so a human reviewing the
 * diff cannot miss it.
 *
 * @param product - Which SDK the placeholder is for
 * @returns The placeholder key
 */
export function placeholderKey(product: ProductId): string {
  return PRODUCTS[product].placeholderKey;
}

/**
 * Whether a key is one of the wizard's placeholders rather than a real key.
 *
 * @param key - Key to test
 * @returns True when the key is a placeholder
 */
export function isPlaceholderKey(key: string): boolean {
  return key === PRODUCTS.publisher.placeholderKey || key === PRODUCTS.advertiser.placeholderKey;
}
