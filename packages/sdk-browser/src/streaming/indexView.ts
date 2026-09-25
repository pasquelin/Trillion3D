/** Index pages read as `Uint32Array` views, made once per page bytes and kept while they live. */
export function createIndexViews() {
  const views = new WeakMap<Uint8Array, Uint32Array>();
  return (bytes: Uint8Array) => {
    if (bytes.byteLength % 4 !== 0) throw new Error('INVALID_INDEX_PAGE_SIZE');
    let view = views.get(bytes);
    if (!view) {
      view = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      views.set(bytes, view);
    }
    return view;
  };
}
