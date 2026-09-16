export function installGpuGlobals() {
  Object.assign(globalThis, {
    GPUBufferUsage: {
      MAP_READ: 1,
      MAP_WRITE: 2,
      COPY_SRC: 4,
      COPY_DST: 8,
      INDEX: 16,
      VERTEX: 32,
      UNIFORM: 64,
      STORAGE: 128,
      INDIRECT: 256,
      QUERY_RESOLVE: 512,
    },
    GPUTextureUsage: {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      STORAGE_BINDING: 8,
      RENDER_ATTACHMENT: 16,
    },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    GPUMapMode: { READ: 1, WRITE: 2 },
  });
}

/** `writeBuffer`'s window: `dataOffset` and `size` count elements of `data`, bytes for an ArrayBuffer. */
export function bytesOf(data: BufferSource, dataOffset = 0, size?: number) {
  if (data instanceof ArrayBuffer)
    return new Uint8Array(data, dataOffset, size ?? data.byteLength - dataOffset);
  const view = data as ArrayBufferView,
    element = (view as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
  const start = view.byteOffset + dataOffset * element;
  return new Uint8Array(
    view.buffer,
    start,
    size === undefined ? view.byteLength - dataOffset * element : size * element,
  );
}

/**
 * Rejoue la compaction que la carte graphique fait des drapeaux de dessin : le compte, puis les
 * rangs des pages dessinables dans l'ordre croissant, comme les noyaux de `gpuDagCompactWgsl.ts`.
 * Elle prolonge le relevé, derrière les pages voulues, dans le même tampon.
 */
export function compactDrawnPages(
  flagBytes: Uint8Array,
  outBytes: Uint8Array,
  nodeCount: number,
  pageCount: number,
) {
  const marks = new Uint32Array(flagBytes.buffer, flagBytes.byteOffset, flagBytes.byteLength / 4);
  const out = new Uint32Array(outBytes.buffer, outBytes.byteOffset, outBytes.byteLength / 4);
  const base = 4 + pageCount;
  let found = 0;
  for (let id = 0; id < pageCount; id++) if (marks[nodeCount + id]) out[base + 4 + found++] = id;
  out[base] = found;
}
