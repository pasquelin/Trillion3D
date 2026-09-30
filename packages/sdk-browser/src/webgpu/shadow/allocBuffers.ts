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
import { createFreshPairs } from './freshPairs.ts';
import { DRAWN_HOST, POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';
import { WORDS_HEADER, sentShadowWord } from './wordsWgsl.ts';

/** The power of two at least `n`: what a bitonic sort of `n` keys spans. */
const spanOf = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
/** Words a snapshot reads back from the GPU pool: its counts, then its owners and last requests. */
const snapshotWords = (pages: number) => POOL_COUNTS.length + 2 * pages;
/** Pairs the host's table words hold at most: the table's changed words of a frame, or every
 *  mapped page once (`table.ts`, `flush`). */
const wordsCap = (pages: number) => 4 * pages;

type Usage = keyof typeof GPUBufferUsage;
/** Words of each buffer of the allocation of a pool of `pages`, with its label and its usages
 *  beside `STORAGE`: its pool, keys, parameters and words, then the draw list, parameters,
 *  arguments, dispatch, views and volumes of the pages the GPU draws itself. */
const allocationBuffers = (pages: number) =>
  ({
    state: ['GPU pool', POOL_COUNTS.length + POOL_FIELDS.length * pages, ['COPY_DST', 'COPY_SRC']],
    keys: ['allocation keys', spanOf(shadowRequestCap(pages)) + spanOf(pages), []],
    params: ['allocation', ALLOC_PARAM_WORDS + shadowRequestCap(pages), ['COPY_DST']],
    words: ['table words', WORDS_HEADER + 2 * wordsCap(pages), ['COPY_DST']],
    drawList: ['GPU draw list', pages, []],
    freshParams: ['GPU pages', FRESH_PARAMS, ['COPY_DST']],
    freshArgs: ['GPU page draws', freshArgWords(pages), ['INDIRECT']],
    freshDispatch: ['GPU page cull', 3, ['INDIRECT']],
    freshFaces: ['GPU page views', pages * FRESH_FACE_WORDS, []],
    freshVolumes: ['GPU page volumes', pages * SHADOW_CULL_FLOATS, []],
  }) satisfies Record<string, [string, number, Usage[]]>;

/** GPU bytes of the allocation of a pool of `pages`: every buffer it makes. */
export const shadowAllocationBytes = (pages: number) =>
  Object.values(allocationBuffers(pages)).reduce((sum, [, words]) => sum + 4 * words, 0);

/**
 * THE BUFFERS OF THE GPU ALLOCATION of one pool (`allocWgsl.ts`), made with its request buffer
 * (`pageRequests.ts`): the GPU pool — counts, then one array per field —, the keys the allocation
 * sorts, the frame's parameters and asks, and the host's table words (`wordsWgsl.ts`). The host
 * makes them and counts their bytes in the memory grant; the GPU fills them. The GPU pool starts as
 * the host's (`seed`): the pool, the table and the plan then follow the GPU from that frame on.
 */
export function createShadowAllocationBuffers(device: GPUDevice, pages: number) {
  const cap = shadowRequestCap(pages),
    needSpan = spanOf(cap),
    made = Object.entries(allocationBuffers(pages)).map(([name, [label, words, usages]]) => [
      name,
      device.createBuffer({
        label: `Trillion3D shadow ${label} v1`,
        size: words * 4,
        usage: (usages as Usage[]).reduce((u, n) => u | GPUBufferUsage[n], GPUBufferUsage.STORAGE),
      }),
    ]);
  const buffers = Object.fromEntries(made) as Record<
    keyof ReturnType<typeof allocationBuffers>,
    GPUBuffer
  >;
  const { state, params: paramBuffer, words: wordBuffer, freshParams } = buffers;
  const params = new Uint32Array(ALLOC_PARAM_WORDS + cap),
    words = new Uint32Array(WORDS_HEADER + 2 * wordsCap(pages)),
    fields = new Int32Array(POOL_FIELDS.length * pages),
    fresh = new Uint32Array(FRESH_PARAMS),
    freshFloats = new Float32Array(fresh.buffer);
  const allocation = {
    ...buffers,
    bytes: shadowAllocationBytes(pages),
    /** Table words this frame's host sent that take a page's depth away (`writeWords`). */
    lost: 0,
    /** Bytes of the pool a snapshot copies (`snapshotWords`). */
    snapshotBytes: snapshotWords(pages) * 4,
    /** True once the GPU pool holds the host's. */
    seeded: false,
    /** The list the GPU pages' pairs land in, sized by the counts snapshots read back. */
    pairs: createFreshPairs(device),
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
    /** The frame's parameters: its frame, each slice's generation, the host's asks, and the
     *  first frame whose asks no need evicts (`allocWgsl.ts`), this one by default. */
    writeParams(frame: number, generation: Uint32Array, asks: ShadowAsks, keepFrom = frame) {
      const count = Math.min(asks.count, cap);
      params[0] = frame;
      params[1] = pages;
      params[2] = cap;
      params[3] = count;
      params[4] = needSpan;
      params[5] = keepFrom;
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
        const word = sentShadowWord(table, entry);
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
      into.listings = from[POOL_COUNTS.indexOf('listings')];
      allocation.pairs.need = from[POOL_COUNTS.indexOf('pairs')];
      into.owner.set(signed.subarray(POOL_COUNTS.length, POOL_COUNTS.length + pages));
      into.requested.set(signed.subarray(POOL_COUNTS.length + pages));
    },
    dispose() {
      for (const buffer of Object.values(buffers)) buffer.destroy();
      allocation.pairs.dispose();
    },
  };
  return allocation;
}
