import { leafCone } from '../../page/cone/cone.ts';
import { SELECTION_NONE as NONE } from '../core/selection.ts';
import type { DagRoot } from './types.ts';
import {
  CLUSTER_WORDS,
  COLD_CONE,
  COLD_HAS_BOX,
  COLD_MAX,
  COLD_MIN,
  COLD_OWNER,
  COLD_TRIANGLES,
  COLD_WORDS,
  HOT_FLAGS,
  HOT_LOD_ERROR,
  HOT_PARENT_ERROR,
  HOT_PARENT_SPHERE,
  HOT_SPHERE,
  packClusterFlags,
} from './layout.ts';

function writeSphere(
  target: Float32Array,
  at: number,
  sphere: ArrayLike<number> | null | undefined,
) {
  const ok = !!sphere && sphere.length >= 4;
  target[at] = ok ? sphere![0] : 0;
  target[at + 1] = ok ? sphere![1] : 0;
  target[at + 2] = ok ? sphere![2] : 0;
  target[at + 3] = ok ? sphere![3] : 0;
}

/** A placement's hot and cold records, written from rank 0 of `hot` and `cold`. `owner` holds the
 *  absolute owner node; the record keeps it relative to `nodeBase`, the placement's first node. */
function writeRecords(
  pages: DagRoot['pages'],
  owner: Uint32Array,
  nodeBase: number,
  hot: Float32Array,
  cold: Float32Array,
) {
  const hotInts = new Uint32Array(hot.buffer),
    coldInts = new Uint32Array(cold.buffer);
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i],
      dst = i * CLUSTER_WORDS;
    writeSphere(hot, dst + HOT_SPHERE, rec.sphere);
    writeSphere(hot, dst + HOT_PARENT_SPHERE, rec.parentSphere ?? rec.sphere);
    const parent =
      typeof rec.parentError === 'number' && Number.isFinite(rec.parentError)
        ? rec.parentError
        : -1;
    hot[dst + HOT_LOD_ERROR] = rec.lodError ?? 0;
    hot[dst + HOT_PARENT_ERROR] = parent;
    // A cluster that no culling leaf owns is unreachable for the CPU cut too; never select it.
    hotInts[dst + HOT_FLAGS] = packClusterFlags(
      owner[i] === NONE,
      rec.level ?? 0,
      !!rec.transparent,
    );
    const cone = leafCone(rec),
      base = i * COLD_WORDS,
      hasBox = rec.min && rec.max ? 1 : 0;
    cold[base + COLD_CONE] = cone.axis[0];
    cold[base + COLD_CONE + 1] = cone.axis[1];
    cold[base + COLD_CONE + 2] = cone.axis[2];
    cold[base + COLD_CONE + 3] = cone.angle;
    cold[base + COLD_HAS_BOX] = hasBox;
    for (let a = 0; a < 3; a++) {
      cold[base + COLD_MIN + a] = hasBox ? rec.min![a] : 0;
      cold[base + COLD_MAX + a] = hasBox ? rec.max![a] : 0;
    }
    // The owner node is only read by the oracle, which replays descent: it stays cold.
    coldInts[base + COLD_OWNER] = owner[i] === NONE ? NONE : owner[i] - nodeBase;
    // Cluster triangles, as an integer word: the GPU now holds the totals.
    coldInts[base + COLD_TRIANGLES] = Math.max(0, Math.trunc(rec.triangles ?? 0));
  }
}

type Block = { hot: Uint32Array; cold: Uint32Array; base: number };
const sameWords = (a: Uint32Array, b: Uint32Array) => {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
};

/**
 * The unique records of a packing. Each placement writes its records into a scratch, then takes
 * those of an earlier placement of the same culling shape when they match TO THE BIT, or keeps
 * its own. The match is on the written words, not on the shape alone: a placement whose pages
 * differ in any field keeps its own records, and the cut reads exactly what it read unshared.
 */
export function createRecordTable() {
  const blocks: Block[] = [],
    byShape = new Map<object, Block[]>();
  let hot = new Float32Array(0),
    cold = new Float32Array(0),
    count = 0;
  return {
    get count() {
      return count;
    },
    /** First record of this placement's pages, shared or new. */
    place(pages: DagRoot['pages'], shape: object, owner: Uint32Array, nodeBase: number) {
      const n = pages.length;
      if (hot.length < n * CLUSTER_WORDS) {
        hot = new Float32Array(n * CLUSTER_WORDS);
        cold = new Float32Array(n * COLD_WORDS);
      }
      writeRecords(pages, owner, nodeBase, hot, cold);
      const hotBits = new Uint32Array(hot.buffer, 0, n * CLUSTER_WORDS),
        coldBits = new Uint32Array(cold.buffer, 0, n * COLD_WORDS);
      const known = byShape.get(shape);
      for (const block of known ?? [])
        if (sameWords(block.hot, hotBits) && sameWords(block.cold, coldBits)) return block.base;
      const block = { hot: hotBits.slice(), cold: coldBits.slice(), base: count };
      count += n;
      blocks.push(block);
      if (known) known.push(block);
      else byShape.set(shape, [block]);
      return block.base;
    },
    /** Copies every unique record into the final buffers, the cold ones from word `coldAt`. */
    finish(clusters: Float32Array, pageCones: Float32Array, coldAt: number) {
      const hotInts = new Uint32Array(clusters.buffer),
        coldInts = new Uint32Array(pageCones.buffer);
      for (const block of blocks) {
        hotInts.set(block.hot, block.base * CLUSTER_WORDS);
        coldInts.set(block.cold, coldAt + block.base * COLD_WORDS);
      }
    },
  };
}
