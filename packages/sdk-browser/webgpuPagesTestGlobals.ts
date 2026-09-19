import assert from 'node:assert/strict';
import { SELECTION_HEADER_WORDS } from './gpuDagLayout.ts';
import { BASE_SLOTS, PAGE_BIND_ALIGN } from './gpuDraw.ts';
import type { MockDraw } from './webgpuPagesMockEncoder.ts';

/**
 * Indirect commands of a hardware-raster image, with the invariants they all hold: at most one call
 * per slot, first instance at zero, page table bound at an aligned offset. Each test keeps only what
 * is its own — instances, bins, buffers.
 */
export function indirectDraws(draws: readonly MockDraw[]) {
  const vis = draws.filter((draw) => draw.indirect);
  assert.ok(vis.length >= 1 && vis.length <= BASE_SLOTS);
  assert.ok(vis.every((draw) => draw.firstInstance === 0));
  assert.ok(vis.every((draw) => (draw.bindOffset ?? 0) % PAGE_BIND_ALIGN === 0));
  return vis;
}

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
 * Replays the compaction the GPU does of draw flags: the count, then the ranks of drawable pages in
 * increasing order, like the kernels of `gpuDagCompactWgsl.ts`. It extends the sample, behind the
 * wanted pages, in the same buffer.
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
 * Pages the CURRENT IMAGE's mask names, read where the GPU posts them: `flags[nodeCount + id]` in
 * the cut buffer. That is the selection the image draws, whichever raster consumes it — hardware by
 * its indirect commands, or compute in place under the `raster-calcul` variant — and not a past
 * image's sample.
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
