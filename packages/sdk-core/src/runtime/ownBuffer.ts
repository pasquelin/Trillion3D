/** The bytes of `view` as an `ArrayBuffer` of their own: its buffer, without a copy, when the view
 *  covers it whole; a copy otherwise — never a leftover of a larger or shared buffer. */
export const ownBuffer = (view: Uint8Array): ArrayBuffer =>
  (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? view.buffer
    : view.slice().buffer) as ArrayBuffer
