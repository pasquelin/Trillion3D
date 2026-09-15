/** Les 256 octets en hexadécimal, écrits une fois pour toutes. */
const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

/**
 * Le SHA-256 d'un tampon, en hexadécimal minuscule. Une lecture de table par octet au lieu d'un
 * `toString(16)` et d'un `padStart` par octet, puis d'un tableau intermédiaire de trente-deux
 * chaînes joint : une page chargée en paie trente-deux, et un lot en paie des milliers.
 */
export async function sha256Hex(bytes: ArrayBuffer) {
  const digested = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let i = 0; i < digested.length; i++) hex += HEX[digested[i]];
  return hex;
}

/** La même chaîne, à partir d'octets déjà hachés : ce que le banc compare terme pour terme. */
export function toHex(digested: Uint8Array) {
  let hex = '';
  for (let i = 0; i < digested.length; i++) hex += HEX[digested[i]];
  return hex;
}
