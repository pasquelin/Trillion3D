// #831: a car driven over a valley floor under the sun. Moved, it stales in each clipmap level only
// the pages its box left and entered (`invalidate.ts`), and each of those pages draws, of the
// moving casters, only the parts of the car whose bounds reach its square: the engine's own cull of
// a caster's sphere against the page's light-space box (`keepCaster`, `cullShader.ts`, restated in
// `cullBox.fixture.ts` and pinned there). A parked car, a moving caster since it first moved, is
// drawn into none of them, and nothing static is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunPageMetres } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import {
  SUN_GRID,
  VIEW,
  cycle,
  planFrame,
  staleEntries,
  sunPageVolume,
  sunPages,
  sunScene,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { keeps } from './cullBox.fixture.ts';

const MIN = [-60, 0, -60],
  MAX = [60, 10, 60];

/** A box `[min, max]` centred at `x, y, z` of `size`, and the sphere round it a cluster carries. */
function part(x: number, y: number, z: number, size: number[]) {
  const min = [x, y, z].map((c, a) => c - size[a] / 2),
    max = [x, y, z].map((c, a) => c + size[a] / 2);
  return { min, max, center: [x, y, z], radius: Math.hypot(...size) / 2 };
}

/** A sports car's body and four wheels at `x, z`, facing −z. */
const car = (x: number, z: number) => [
  part(x, 0.75, z, [1.86, 0.45, 4.5]),
  ...[-1.35, 1.35].flatMap((dz) =>
    [-0.8, 0.8].map((dx) => part(x + dx, 0.33, z + dz, [0.26, 0.66, 0.66])),
  ),
];

/** The box round every part. */
const boxOf = (parts: ReturnType<typeof car>) => ({
  min: [0, 1, 2].map((a) => Math.min(...parts.map((p) => p.min[a]))),
  max: [0, 1, 2].map((a) => Math.max(...parts.map((p) => p.max[a]))),
});

test('a moving car stales per level only the pages its two boxes reach, each drawing only its parts over it', () => {
  const { store, plan, slice } = sunScene(MIN, MAX);
  // Three clipmap levels mapped and drawn over the floor: pages of 4, 8 and 16 metres.
  const levels = [4, 8, 16].map((metres) => {
    let level = plan.sun.finest[slice];
    while (sunPageMetres(level) < metres) level++;
    return level;
  });
  const read = () => levels.flatMap((level) => sunPages(plan, slice, level, SUN_GRID));
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, read, VIEW, MIN, MAX);
  assert.deepEqual(staleEntries(plan), [], 'every page read is drawn');
  // Driven half a metre a frame; the other car stays parked twenty metres away.
  const was = car(6, -6),
    now = car(6, -6.5),
    parked = car(-14, 6),
    left = boxOf(was),
    entered = boxOf(now);
  plan.worldChanged(left.min, left.max, true);
  plan.worldChanged(entered.min, entered.max, true);
  planFrame(plan, store, frame, VIEW, MIN, MAX);
  const { pool } = plan,
    volumeOf = (page: number) =>
      sunPageVolume(plan, slice, pool.view[page], pool.x[page], pool.y[page]);
  const reach = (page: number, box: { min: number[]; max: number[] }) => {
    const centre = box.min.map((v, a) => (v + box.max[a]) / 2);
    return keeps(volumeOf(page), centre, Math.hypot(...box.max.map((v, a) => v - box.min[a])) / 2);
  };
  let kept = 0,
    staled = 0;
  for (const level of levels) {
    const mapped = [...pool.owner.keys()].filter(
        (page) => pool.owner[page] >= 0 && pool.view[page] === level,
      ),
      dirty = mapped.filter((page) => pool.dirty[page]);
    assert.ok(dirty.length > 0, `level ${level}: the car's pages are staled`);
    assert.ok(dirty.length <= 4, `level ${level}: ${dirty.length} of ${mapped.length} pages`);
    for (const page of mapped) {
      const under = reach(page, left) || reach(page, entered);
      if (pool.dirty[page]) assert.ok(under, `level ${level}: page ${page} lies off both boxes`);
      // A page whose square holds a point of either box is staled.
      for (const box of [left, entered])
        if (
          keeps(
            volumeOf(page),
            box.min.map((v, a) => (v + box.max[a]) / 2),
            0,
          )
        )
          assert.ok(pool.dirty[page], `level ${level}: page ${page} under the car is kept`);
    }
    for (const page of dirty) {
      const volume = volumeOf(page),
        drawn = [...now, ...parked].filter((c) => keeps(volume, c.center, c.radius));
      assert.ok(
        drawn.every((c) => now.includes(c)),
        'the parts of the moved car over it, never the parked one',
      );
      // A page the car only left draws none of it: the floor's static depth is restored alone.
      if (drawn.length) assert.ok(reach(page, entered), `page ${page} draws a car it left`);
      kept += drawn.length;
    }
    staled += dirty.length;
  }
  // Six pages over three levels keep 21 casters, not every moving caster in each (60).
  const all = now.length + parked.length;
  assert.ok(kept <= staled * now.length, `${kept} casters kept over ${staled} pages`);
  assert.ok(kept < staled * all, `${kept} casters kept over ${staled} pages, not ${staled * all}`);
});
