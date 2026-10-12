import { hexOfBytes } from '../../../math/src/scalar/hex.ts'

/**
 * SHA-256 of a buffer, in lowercase hexadecimal (`hexOfBytes`). A view is digested where it lies,
 * never copied.
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  return hexOfBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}
