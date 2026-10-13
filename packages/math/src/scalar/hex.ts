/** The 256 bytes in hexadecimal, written once and for all. */
const HEX: string[] = []
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'))

/** `bytes` in lowercase hexadecimal, two digits a byte: one table lookup per byte instead of a
 *  `toString(16)` and a `padStart` per byte and a joined intermediate array. */
export function hexOfBytes(bytes: ArrayLike<number>) {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += HEX[bytes[i]]
  return hex
}
