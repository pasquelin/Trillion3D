import { SELECTION_HEADER_WORDS } from './gpuDagLayout.ts';

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
  const head = SELECTION_HEADER_WORDS,
    base = head + pageCount;
  let found = 0;
  for (let id = 0; id < pageCount; id++) if (marks[nodeCount + id]) out[base + head + found++] = id;
  out[base] = found;
}

/**
 * Les pages que le masque de l'IMAGE EN COURS nomme, lues là où la carte les pose :
 * `flags[nodeCount + id]` dans le tampon de la coupe. C'est ce que le raster de calcul consomme sur
 * place depuis b72278c6, et non le relevé d'une image passée — les tests qui comptaient les
 * instances d'une commande indirecte comptaient l'ancien chemin matériel, qui ne porte plus la
 * géométrie opaque.
 */
export function drawnPageIds(
  buffers: ReadonlyArray<{ label?: string; data: Uint8Array }>,
  nodeCount: number,
  pageCount: number,
) {
  const buffer = buffers.find((entry) => entry.label === 'WG DAG flags');
  if (!buffer) throw new Error('WG DAG flags buffer absent');
  const marks = new Uint32Array(
    buffer.data.buffer,
    buffer.data.byteOffset,
    buffer.data.byteLength / 4,
  );
  const ids: number[] = [];
  for (let id = 0; id < pageCount; id++) if (marks[nodeCount + id]) ids.push(id);
  return ids;
}
