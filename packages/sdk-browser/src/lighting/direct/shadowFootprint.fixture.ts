// #1250: pages drawn by the pool each for its own footprint, and the texels a shadow read takes
// in them — read by the shipped `shadowPageWord` in Node (`shadowFootprint.test.ts`) and on a
// device (`tests/browser/probes/shadow-footprint-gpu.ts`), against the same expectations.
import { createShadowPool, DRAW_ALL } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { createShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import {
  PAGE_FOOTPRINT_FULL,
  PAGE_FOOTPRINT_SHIFT,
} from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';
import {
  LAMP_SIDE,
  SHADOW_PAGE,
  SUN_WINDOW,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { lampEntry, sunEntry } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { shadowTableStride } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { pageFootprint } from '../../../../sdk-core/src/scene/light-shadow/footprint.fixture.ts';

const SHADOW_TABLE_STRIDE = shadowTableStride(SUN_WINDOW);

/** A map as `ShadowMap` lays it out: first entry, ring, pages per side, window origin. */
export type PageMap = { base: number; ring: number; pages: number; ox: number; oy: number };
/** One read: page `p` of `map` at map texel `t`, the entry it asks for, the word it must read. */
type FootprintRead = { map: PageMap; p: number[]; t: number[]; entry: number; word: number };

/** The word's bits below its footprint: what a reader decodes of a drawn page. */
export const DRAWN_BITS = 2 ** PAGE_FOOTPRINT_SHIFT - 1;

const SUN: PageMap = { base: 0, ring: 1, pages: SUN_WINDOW, ox: 5, oy: -3 };
const LAMP: PageMap = { base: SHADOW_TABLE_STRIDE, ring: 0, pages: LAMP_SIDE, ox: 0, oy: 0 };
const entryOf = (map: PageMap, [x, y]: number[]) =>
  map.ring ? sunEntry(0, x + map.ox, y + map.oy) : map.base + lampEntry(0, 0, x, y);

/** A footprint away from the page's low x edge, and one along it — its top bit set. */
const AWAY = pageFootprint(32, 64, 96, 128),
  ALONG = pageFootprint(0, 0, 32, 64);
/** Each read's page footprint, its texel relative to that page's first, and whether it lies in. */
const READS: Array<[number, number[], boolean]> = [
  [AWAY, [64, 100], true],
  [AWAY, [10, 100], false],
  [AWAY, [64, 20], false],
  // A neighbour read across the seam, from the page before: the page's texel nearest it.
  [AWAY, [-1, 100], false],
  [ALONG, [-1, 50], true],
  [PAGE_FOOTPRINT_FULL, [127.5, 0.5], true],
  [PAGE_FOOTPRINT_FULL, [-1, -1], true],
];

/** Every read of `READS` on a sun level and on a lamp face, each page its own, drawn by the pool
 *  for its footprint: the page table, and the reads. */
export function footprintReads() {
  const table = createShadowTable(64),
    pool = createShadowPool(8),
    reads: FootprintRead[] = [];
  pool.beginAllocation(0);
  for (const map of [SUN, LAMP])
    READS.forEach(([footprint, local, inside], i) => {
      const p = [1 + i, 2],
        entry = entryOf(map, p);
      pool.drew(table, pool.take(table, entry, 0, 0, 0), DRAW_ALL, 0, footprint);
      const t = local.map((v, a) => p[a] * SHADOW_PAGE + v);
      reads.push({ map, p, t, entry, word: inside ? table.words[entry] & DRAWN_BITS : 0 });
    });
  return { words: table.words, reads };
}
