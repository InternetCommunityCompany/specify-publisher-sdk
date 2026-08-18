/**
 * UUIDv7 generation (time-ordered) with a crypto-random fallback.
 *
 * Used for client-generated identifiers such as session ids and `spclid`
 * click ids. UUIDv7 is safe to index server-side because the leading 48 bits
 * are a millisecond timestamp. The value is opaque and never encodes PII.
 */

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
    return bytes;
  }
  // Non-crypto fallback for environments without WebCrypto. These identifiers
  // are not security tokens (the security-sensitive HMAC is applied server
  // side), so a weaker source is acceptable purely to keep the SDK functioning.
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Generate a UUIDv7 string.
 *
 * Most runtimes still emit v4 from `crypto.randomUUID`, so v7 is constructed by
 * hand here to guarantee time ordering.
 *
 * @returns A RFC 9562 version 7 UUID
 */
export function uuidv7(): string {
  const now = Date.now();
  const bytes = getRandomBytes(16);

  // 48-bit big-endian timestamp in the first 6 bytes.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7 in the high nibble of byte 6.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // RFC 4122 variant (10xx) in the high bits of byte 8.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, "0"));
  }

  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}
