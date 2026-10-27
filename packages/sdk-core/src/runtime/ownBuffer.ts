/** The bytes of `view` as an `ArrayBuffer` of their own: its buffer, without a copy, when the view
 *  covers it whole; a copy otherwise — never a leftover of a larger or shared buffer. */
export const ownBuffer = (view: Uint8Array): ArrayBuffer =>
  (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? view.buffer
    : view.slice().buffer) as ArrayBuffer

/** `count` words of `bytes` from byte `at`, to its end by default: a view when the bytes lie
 *  aligned to a word in their buffer, else a copy of their own. */
export const wordsOf = (bytes: Uint8Array, at = 0, count = (bytes.byteLength - at) / 4) =>
  (bytes.byteOffset + at) % 4 === 0
    ? new Uint32Array(bytes.buffer, bytes.byteOffset + at, count)
    : new Uint32Array(bytes.slice(at, at + count * 4).buffer)
