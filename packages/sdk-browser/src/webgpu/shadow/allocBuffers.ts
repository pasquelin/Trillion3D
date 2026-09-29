import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import type { ShadowPoolSnapshot } from '../../../../sdk-core/src/scene/light-shadow/mirror.ts';
import type { ShadowAsks } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  shadowRequestCap,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { ALLOC_PARAM_WORDS } from './allocWgsl.ts';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { FRESH_FACE_WORDS, FRESH_PARAM_WORDS, FRESH_PARAMS, freshArgWords } from './freshLayout.ts';
import { DRAWN_HOST, POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';
import { WORDS_HEADER } from './wordsWgsl.ts';

/** The power of two at least `n`: what a bitonic sort of `n` keys spans. */
const spanOf = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
/** Words a snapshot reads back from the GPU pool: its counts, then its owners and last requests. */
const snapshotWords = (pages: number) => POOL_COUNTS.length + 2 * pages;
/** Pairs the host's table words hold at most: the table's changed words of a frame, or every
 *  mapped page once (`table.ts`, `flush`). */
const wordsCap = (pages: number) => 4 * pages;

/** GPU bytes of the allocation of a pool of `pages`: its pool, keys, parameters and words, then
 *  the draw list, parameters, arguments, views and volumes of the pages the GPU draws itself. */
export const shadowAllocationBytes = (pages: number) =>
  4 *
  (POOL_COUNTS.length +
    POOL_FIELDS.length * pages +
    spanOf(shadowRequestCap(pages)) +
    spanOf(pages) +
    ALLOC_PARAM_WORDS +
    shadowRequestCap(pages) +
    WORDS_HEADER +
    2 * wordsCap(pages) +
    pages +
    FRESH_PARAMS +
    freshArgWords(pages) +
    3 +
    pages * (FRESH_FACE_WORDS + SHADOW_CULL_FLOATS));

/**
 * THE BUFFERS OF THE GPU ALLOCATION of one pool (`allocWgsl.ts`), made with its request buffer
 * (`pageRequests.ts`): the GPU pool — counts, then one array per field —, the keys the allocation
 * sorts, the frame's parameters and asks, and the host's table words (`wordsWgsl.ts`). The host
 * makes them and counts their bytes in the memory grant; the GPU fills them. The GPU pool starts as
 * the host's (`seed`): the pool, the table and the plan then follow the GPU from that frame on.
 */
export function createShadowAllocationBuffers(device: GPUDevice, pages: number) {
  const cap = shadowRequestCap(pages),
    needSpan = spanOf(cap);
  const buffer = (label: string, words: number, usage: number) =>
    device.createBuffer({ label, size: words * 4, usage: GPUBufferUsage.STORAGE | usage });
  const state = buffer(
    'Trillion3D shadow GPU pool v1',
    POOL_COUNTS.length + POOL_FIELDS.length * pages,
    GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  );
  const keys = buffer('Trillion3D shadow allocation keys v1', needSpan + spanOf(pages), 0);
  const params = new Uint32Array(ALLOC_PARAM_WORDS + cap),
    words = new Uint32Array(WORDS_HEADER + 2 * wordsCap(pages)),
    fields = new Int32Array(POOL_FIELDS.length * pages),
    fresh = new Uint32Array(FRESH_PARAMS),
    freshFloats = new Float32Array(fresh.buffer);
  const paramBuffer = buffer(
    'Trillion3D shadow allocation v1',
    params.length,
    GPUBufferUsage.COPY_DST,
  );
  const wordBuffer = buffer(
    'Trillion3D shadow table words v1',
    words.length,
    GPUBufferUsage.COPY_DST,
  );
  const drawList = buffer('Trillion3D shadow GPU draw list v1', pages, 0),
    freshParams = buffer('Trillion3D shadow GPU pages v1', FRESH_PARAMS, GPUBufferUsage.COPY_DST),
    freshArgs = buffer(
      'Trillion3D shadow GPU page draws v1',
      freshArgWords(pages),
      GPUBufferUsage.INDIRECT,
    ),
    freshDispatch = buffer('Trillion3D shadow GPU page cull v1', 3, GPUBufferUsage.INDIRECT),
    freshFaces = buffer('Trillion3D shadow GPU page views v1', pages * FRESH_FACE_WORDS, 0),
    freshVolumes = buffer('Trillion3D shadow GPU page volumes v1', pages * SHADOW_CULL_FLOATS, 0),
    made = [state, keys, paramBuffer, wordBuffer, drawList, freshParams, freshArgs];
  made.push(freshDispatch, freshFaces, freshVolumes);
  const allocation = {
    state,
    keys,
    params: paramBuffer,
    words: wordBuffer,
    drawList,
    freshParams,
    freshArgs,
    freshDispatch,
    freshFaces,
    freshVolumes,
    bytes: made.reduce((sum, buffer) => sum + buffer.size, 0),
    /** Table words this frame's host sent that take a page's depth away (`writeWords`). */
    lost: 0,
    /** Bytes of the pool a snapshot copies (`snapshotWords`). */
    snapshotBytes: snapshotWords(pages) * 4,
    /** True once the GPU pool holds the host's. */
    seeded: false,
    /** The GPU pool and its table as the host's `plan` holds them now: into `table` of `data`. */
    seed(plan: ShadowPlan, data: GPUBuffer, tableOffset: number) {
      const { pool, records, table } = plan,
        at = (field: (typeof POOL_FIELDS)[number]) => POOL_FIELDS.indexOf(field) * pages;
      fields.set(pool.owner, at('owner'));
      fields.set(pool.requested, at('requested'));
      fields.set(pool.rank, at('rank'));
      fields.set(pool.view, at('view'));
      fields.set(pool.x, at('x'));
      fields.set(pool.y, at('y'));
      for (let page = 0; page < pages; page++)
        fields[at('generation') + page] = records.generation[pool.slice[page]];
      // What the host's pool holds, the host drew or will draw.
      fields.fill(DRAWN_HOST, at('drawnBy'), at('drawnBy') + pages);
      device.queue.writeBuffer(state, 0, new Uint32Array(POOL_COUNTS.length));
      device.queue.writeBuffer(state, POOL_COUNTS.length * 4, fields);
      device.queue.writeBuffer(data, tableOffset, table.words);
      allocation.seeded = true;
    },
    /** The GPU-drawn pages' parameters (`freshLayout.ts`): the pool's layer side and layers, the
     *  caster rows the cull tests — the table's, the blended casters' —, the pairs it may keep,
     *  then each slice's emitter and far plane. */
    writeFresh(
      side: number,
      layers: number,
      rows: number,
      blend: readonly [number, number],
      capacity: number,
      slices: Float32Array,
    ) {
      fresh.set([pages, side, layers, rows, blend[0], blend[1], capacity]);
      freshFloats.set(slices, FRESH_PARAM_WORDS);
      device.queue.writeBuffer(freshParams, 0, fresh);
    },
    /** The frame's parameters: its frame, each slice's generation, the host's asks. */
    writeParams(frame: number, generation: Uint32Array, asks: ShadowAsks) {
      const count = Math.min(asks.count, cap);
      params[0] = frame;
      params[1] = pages;
      params[2] = cap;
      params[3] = count;
      params[4] = needSpan;
      params.set(generation, 8);
      params.set(asks.entries.subarray(0, count), ALLOC_PARAM_WORDS);
      device.queue.writeBuffer(paramBuffer, 0, params, 0, ALLOC_PARAM_WORDS + count);
    },
    /** Sends the table words frame `frame`'s plan changed that map a page (`wordsWgsl.ts`): its
     *  table's flush, run through `flush`. Returns how many. */
    writeWords(
      plan: ShadowPlan,
      frame: number,
      flush: (sink: (first: number, count: number) => void) => void,
    ) {
      const { pool, table } = plan;
      let count = 0;
      allocation.lost = 0;
      const send = (entry: number) => {
        const word = table.words[entry];
        if (!(word & PAGE_MAPPED)) return;
        if (!(word & PAGE_VALID)) allocation.lost++;
        words[WORDS_HEADER + 2 * count] = entry;
        words[WORDS_HEADER + 2 * count++ + 1] = word;
      };
      flush((first, runs) => {
        // The whole table: every page the host maps, once.
        if (runs === table.entries)
          for (let page = 0; page < pool.pages; page++) {
            if (pool.owner[page] >= 0) send(pool.owner[page]);
          }
        else for (let entry = first; entry < first + runs; entry++) send(entry);
      });
      words[0] = count;
      words[1] = pages;
      words[2] = frame;
      if (count) device.queue.writeBuffer(wordBuffer, 0, words, 0, WORDS_HEADER + 2 * count);
      return count;
    },
    /** Reads a snapshot's words into `into`. */
    read(from: Uint32Array, into: ShadowPoolSnapshot) {
      const signed = new Int32Array(from.buffer, from.byteOffset, from.length);
      into.allocated = from[POOL_COUNTS.indexOf('allocated')];
      into.refused = from[POOL_COUNTS.indexOf('refused')];
      into.drawn = from[POOL_COUNTS.indexOf('drawn')];
      into.owner.set(signed.subarray(POOL_COUNTS.length, POOL_COUNTS.length + pages));
      into.requested.set(signed.subarray(POOL_COUNTS.length + pages));
    },
    dispose() {
      for (const buffer of made) buffer.destroy();
    },
  };
  return allocation;
}
