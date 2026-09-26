// A cut delta of the estate's scale (#824): 2 754 primitives, 15.8 M triangles. Index pages are
// content-addressed (`../row/pageSlots.ts`), so two primitives whose clusters carry the same index
// bytes share one cache key while each cluster keeps its own level. A key weighed at one level
// and released by a placement of another used to leave the wrong level list, drive its count
// below zero and throw "Invalid array length" out of `applyCut`.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createCutDelta } from '../cut/delta.ts';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createWebgpuResidencySets } from './sets.ts';
import { keysOf } from './sets.fixture.ts';

const PRIMITIVES = 2754,
  CLUSTERS = 45,
  LEVELS = 5,
  TRIANGLES = 128;

/** Each primitive's clusters, levels 0 to 4; every even primitive's level-0 cluster carries the
 *  same index bytes as its odd neighbour's level-1 cluster, so both sit at one address. */
function estate() {
  const packed: PageRec[] = [];
  for (let primitive = 0; primitive < PRIMITIVES; primitive++)
    for (let cluster = 0; cluster < CLUSTERS; cluster++) {
      const level = cluster % LEVELS,
        pair = primitive >> 1;
      const shared = (primitive % 2 === 0 && level === 0) || (primitive % 2 === 1 && level === 1);
      const url = shared && cluster < LEVELS ? `shared-${pair}` : `p${primitive}-c${cluster}`;
      packed.push({ url, level, triangles: TRIANGLES } as unknown as PageRec);
    }
  packed.forEach((page, index) => (page.packedIndex = index));
  const tracking = createWebgpuPageTracking(packed);
  const bootstrapKey = new Uint8Array(tracking.keyCount);
  const sets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages: packed });
  return { packed, tracking, sets, delta: createCutDelta(packed, []) };
}

test('a cut delta of the estate applies when placements of one address differ in level', () => {
  const { packed, tracking, sets, delta } = estate();
  assert.equal(
    packed.reduce((sum, page) => sum + page.triangles, 0),
    PRIMITIVES * CLUSTERS * TRIANGLES,
  );
  const ids = (keep: (level: number) => boolean) =>
    packed.flatMap((page, id) => (keep(page.level ?? 0) ? [id] : []));
  const coarse = ids((level) => level >= 1),
    fine = ids((level) => level === 0),
    all = ids(() => true);
  // Far, then closer — both placements of a shared address held, the level-1 one first — then
  // near, where the level-1 placement leaves, then far again, where the level-0 one leaves last.
  for (const [label, cut] of [
    ['far', coarse],
    ['closer', all],
    ['near', fine],
    ['far again', coarse],
  ] as const) {
    delta.apply(cut);
    sets.applyCut(delta);
    const keys = new Set(cut.map((id) => tracking.keyOf(packed[id])));
    assert.equal(sets.requestedCount, keys.size, `${label}: requested pages`);
    // A budget below the cut ranks it: every queued key belongs to the cut, once.
    const room = keys.size >> 1;
    assert.equal(sets.applyBudget(room), true, `${label}: over budget`);
    const queued = keysOf(tracking.wanted);
    assert.equal(queued.size, room, `${label}: queue fills the budget`);
    for (const key of queued) assert.ok(keys.has(key), `${label}: key ${key} left the cut`);
  }
});
