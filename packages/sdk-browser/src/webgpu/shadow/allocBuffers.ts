import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import type { ShadowPoolSnapshot } from '../../../../sdk-core/src/scene/light-shadow/mirror.ts';
import type { ShadowAsks } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  PAGE_WITHDRAWN,
  shadowRequestCap,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { FRESH_PARAM_WORDS, FRESH_PARAMS } from './freshLayout.ts';
import { DRAWN_GPU, DRAWN_HOST } from './poolDrawn.ts';
import { shadowPagesPerFrame } from '../../gpu/shadow/batchBudget.ts';
import { sentShadowWord } from './wordsWgsl.ts';
import {
  ALLOC_PARAM_WORDS,
  POOL_COUNTS,
  POOL_FIELDS,
  WORDS_HEADER,
  allocationBuffers,
  shadowAllocationBytes,
  spanOf,
  wordsCap,
  type Usage,
} from './allocLayout.ts';

/** Words a snapshot reads back from the GPU pool: its counts, then its fields up to `drawnBy` (its
 *  owners, last requests and draws, `POOL_FIELDS`). */
const snapshotWords = (pages: number) =>
  POOL_COUNTS.length + (POOL_FIELDS.indexOf('drawnBy') + 1) * pages;

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
    /** The pages the GPU maps a frame at most (`shadowPagesPerFrame`): the rest the next frames. */
    pagesPerFrame: shadowPagesPerFrame(pages),
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
     *  the error in texels it chooses their level at, then each slice's emitter and far plane. */
    writeFresh(
      side: number,
      layers: number,
      rows: number,
      blend: readonly [number, number],
      capacity: number,
      threshold: number,
      slices: Float32Array,
    ) {
      fresh.set([pages, side, layers, rows, blend[0], blend[1], capacity]);
      freshFloats[7] = threshold;
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
      params[6] = allocation.pagesPerFrame;
      params.set(generation, 8);
      params.set(asks.entries.subarray(0, count), ALLOC_PARAM_WORDS);
      device.queue.writeBuffer(paramBuffer, 0, params, 0, ALLOC_PARAM_WORDS + count);
    },
    /** Sends the table words frame `frame`'s plan changed that map a page (`wordsWgsl.ts`): its
     *  table's flush, run through `flush`. Returns the invocations they take: one a word
     *  (`words`), and one a page (`withdraw`) when the list could not hold every withdrawn entry —
     *  every GPU-only draw then lost, before the words. */
    writeWords(
      plan: ShadowPlan,
      frame: number,
      flush: (sink: (first: number, count: number) => void) => void,
    ) {
      const { pool, table } = plan,
        cap = wordsCap(pages);
      let count = 0,
        every = 0;
      allocation.lost = 0;
      const send = (entry: number) => {
        const word = sentShadowWord(table, entry);
        // An entry the host does not map goes out only withdrawn: a GPU draw of it is redone.
        if (!(word & (PAGE_MAPPED | PAGE_WITHDRAWN))) return;
        if (count === cap) return void (every = 1);
        if (!(word & PAGE_VALID)) allocation.lost++;
        words[WORDS_HEADER + 2 * count] = entry;
        words[WORDS_HEADER + 2 * count++ + 1] = word;
      };
      flush((first, runs) => {
        if (runs !== table.entries) {
          for (let entry = first; entry < first + runs; entry++) send(entry);
          return;
        }
        // The whole table: every page the host maps once, and every entry withdrawn it does not
        // map, whose GPU draw would otherwise be adopted current (#831).
        for (let page = 0; page < pool.pages; page++)
          if (pool.owner[page] >= 0) send(pool.owner[page]);
        table.eachWithdrawn((entry) => void (!(table.words[entry] & PAGE_MAPPED) && send(entry)));
      });
      words[0] = count;
      words[1] = pages;
      words[2] = frame;
      words[3] = every;
      if (count || every)
        device.queue.writeBuffer(wordBuffer, 0, words, 0, WORDS_HEADER + 2 * count);
      return { words: count, withdraw: every ? pages : 0 };
    },
    /** Reads a snapshot's words into `into`. */
    read(from: Uint32Array, into: ShadowPoolSnapshot) {
      const signed = new Int32Array(from.buffer, from.byteOffset, from.length);
      into.allocated = from[POOL_COUNTS.indexOf('allocated')];
      into.refused = from[POOL_COUNTS.indexOf('refused')];
      into.drawn = from[POOL_COUNTS.indexOf('drawn')];
      into.listings = from[POOL_COUNTS.indexOf('listings')];
      const field = (name: (typeof POOL_FIELDS)[number]) => {
        const start = POOL_COUNTS.length + POOL_FIELDS.indexOf(name) * pages;
        return signed.subarray(start, start + pages);
      };
      into.owner.set(field('owner'));
      into.requested.set(field('requested'));
      const { gpuDrawn } = into;
      if (gpuDrawn) {
        const drawnBy = field('drawnBy');
        for (let p = 0; p < pages; p++) gpuDrawn[p] = +(drawnBy[p] === DRAWN_GPU);
      }
    },
    dispose() {
      for (const buffer of Object.values(buffers)) buffer.destroy();
    },
  };
  return allocation;
}
