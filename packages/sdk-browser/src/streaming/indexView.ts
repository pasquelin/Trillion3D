const views = new WeakMap<Uint8Array, Uint32Array>()

/** An index page's bytes read as a `Uint32Array`, made once per page bytes and kept while they
 *  live. */
export function asIndices(bytes: Uint8Array) {
  if (bytes.byteLength % 4 !== 0) throw new Error('INVALID_INDEX_PAGE_SIZE')
  let view = views.get(bytes)
  if (!view) {
    view = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    views.set(bytes, view)
  }
  return view
}
