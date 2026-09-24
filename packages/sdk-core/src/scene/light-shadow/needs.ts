import type { ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import { PAGE_MAPPED } from './virtual.ts';

/**
 * THE UNMAPPED PAGES A REQUEST ASKS FOR, and their allocation: each noted with the light, view,
 * page and coarseness it names, then mapped coarsest first, then by table entry — never in the
 * order they were noted, the order the GPU's atomics appended a report's entries in. Allocated
 * once, `capacity` entries.
 */
export function createShadowNeeds(table: ShadowTable, pool: ShadowPool, capacity: number) {
  const entry = new Int32Array(capacity),
    slice = new Int32Array(capacity),
    view = new Int32Array(capacity),
    x = new Int32Array(capacity),
    y = new Int32Array(capacity),
    rank = new Float64Array(capacity),
    order = new Int32Array(capacity);
  let count = 0;
  const coarsestFirst = (a: number, b: number) => rank[b] - rank[a] || entry[a] - entry[b] || a - b;
  return {
    get count() {
      return count;
    },
    clear() {
      count = 0;
    },
    /** Notes unmapped `at` of `on`: view `v`, page `(px, py)`, coarseness `coarse`. */
    note(at: number, on: number, v: number, px: number, py: number, coarse: number) {
      entry[count] = at;
      slice[count] = on;
      view[count] = v;
      x[count] = px;
      y[count] = py;
      rank[count] = coarse;
      order[count] = count;
      count++;
    },
    /** Maps every entry noted and still unmapped into pages no report of `reportFrame` or later
     *  asked for; counts what it mapped and refused. */
    allocate(
      reportFrame: number,
      nowMs: number,
      frame: number,
      counts: { allocated: number; refused: number },
    ) {
      order.subarray(0, count).sort(coarsestFirst);
      pool.beginAllocation(reportFrame);
      for (let k = 0; k < count; k++) {
        const n = order[k];
        // A floor under several named pages is noted once for each.
        if (table.words[entry[n]] & PAGE_MAPPED) continue;
        const page = pool.take(table, entry[n], reportFrame, nowMs, frame);
        if (page < 0) {
          counts.refused += count - k;
          return;
        }
        pool.slice[page] = slice[n];
        pool.view[page] = view[n];
        pool.x[page] = x[n];
        pool.y[page] = y[n];
        pool.rank[page] = rank[n];
        counts.allocated++;
      }
    },
  };
}
