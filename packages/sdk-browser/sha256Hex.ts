/** The 256 bytes in hexadecimal, written once and for all. */
const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

/**
 * SHA-256 of a buffer, in lowercase hexadecimal. One table lookup per byte instead of a
 * `toString(16)` and a `padStart` per byte, then a thirty-two-string intermediate array
 * joined: a loaded page pays thirty-two of those, and a batch pays thousands.
 */
export async function sha256Hex(bytes: ArrayBuffer) {
  const digested = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let i = 0; i < digested.length; i++) hex += HEX[digested[i]];
  return hex;
}

/** The same string, from bytes already hashed: what the bench compares term for term. */
export function toHex(digested: Uint8Array) {
  let hex = '';
  for (let i = 0; i < digested.length; i++) hex += HEX[digested[i]];
  return hex;
}
