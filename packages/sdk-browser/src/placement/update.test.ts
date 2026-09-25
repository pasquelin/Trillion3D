// #525: a written range of placement rows stales only what moved in it. The world writes the rows
// of every moved node and hands each instance buffer's span once (`world/core/worldPoses.ts`); a row
// inside that span left where it stands — a still mesh between two written ones, a sleeping
// vehicle's wheel posed again at the same place — is no move, and two roots that moved are two
// boxes, never the room between them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boxTransform } from '../../../sdk-core/src/index.ts';
import {
  cycleDrawn,
  nudged,
} from '../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { sunScene } from '../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import {
  covers,
  entriesOf,
  sunBlock,
} from '../../../sdk-core/src/scene/light-shadow/sunView.fixture.ts';
import { createShadowMobility } from '../webgpu/shadow/mobility.ts';
import { createPlacementRows, placementWorld } from './rows.ts';
import { followPlacementRows } from './update.ts';

/** Placements of local boxes `boxes`, at the origin, rows of one buffer, and their mobility. */
function placed(boxes: number[][]) {
  const rows = createPlacementRows(boxes.length);
  const roots = boxes.map((local, index) => {
    rows.matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], index * 16);
    rows.live[index] = 1;
    const root = {
      pages: [],
      world: placementWorld(rows, index),
      localBox: Float64Array.from(local),
      worldBox: new Float64Array(6),
      placement: { rows, index },
    };
    boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
    return root;
  });
  const mobility = createShadowMobility();
  mobility.ensure(roots.length, 1, (rank) => roots[rank].world.elements);
  /** Moves row `index` to `x` along the world's x, and hands rows `[0, last]` as written. */
  const write = (index: number, x: number, touched: (min: number[], max: number[]) => void) => {
    rows.matrices[index * 16 + 12] = x;
    return followPlacementRows(
      roots as never,
      rows,
      0,
      boxes.length - 1,
      undefined,
      mobility.move,
      undefined,
      touched,
    );
  };
  return { roots, write };
}

/** A small caster, the ground under it, a still box far off, as local boxes. */
const CASTER = [-0.1, 0, -0.1, 0.1, 0.2, 0.1],
  GROUND = [-5, -0.1, -5, 5, 0, 5],
  FAR = [20, 0, 20, 21, 1, 21];

test('a written range stales the root that moved alone, the still rows in it none', () => {
  const { write } = placed([CASTER, GROUND, FAR]);
  const boxes: number[][] = [];
  assert.equal(
    write(0, 0.1, (min, max) => boxes.push([...min, ...max])),
    true,
  );
  assert.deepEqual(boxes, [[-0.1, 0, -0.1, 0.2, 0.2, 0.1]], 'the caster where it was and is');
  boxes.length = 0;
  assert.equal(
    write(0, 0.1, (min, max) => boxes.push([...min, ...max])),
    false,
  );
  assert.deepEqual(boxes, [], 'written again where it stands: no move');
});

test('a caster moving over a still ground redraws only the pages its swept box covers', () => {
  const { store, plan, slice } = sunScene();
  const read = () => sunBlock(plan, slice, [3, 4, 5], [0, 5, 0], 8);
  const named = read();
  for (let frame = 1; frame < 4; frame++)
    cycleDrawn(plan, store, frame, () => entriesOf(plan, slice, named), nudged(frame));
  const { write } = placed([CASTER, GROUND, FAR]);
  const current = new Set<number>();
  let was = 0;
  for (let frame = 4; frame < 16; frame++) {
    const x = frame * 0.02,
      // The caster's own swept box, where it was and where it is.
      min = [was - 0.1, 0, -0.1],
      max = [x + 0.1, 0.2, 0.1];
    was = x;
    let boxes = 0;
    write(0, x, (lo, hi) => {
      boxes++;
      plan.worldChanged(lo, hi);
    });
    current.clear();
    for (let page = 0; page < plan.pool.pages; page++)
      if (plan.pool.owner[page] >= 0 && plan.pool.valid[page] && !plan.pool.dirty[page])
        current.add(page);
    // The camera moves too: a page that stays in the view stays cached.
    const drawn = cycleDrawn(
      plan,
      store,
      frame,
      () => entriesOf(plan, slice, named),
      nudged(frame),
    );
    assert.equal(boxes, 1, `frame ${frame}: the caster alone moved`);
    let under = 0;
    for (const page of drawn) {
      if (!current.has(page) || plan.records.isFloor(page)) continue;
      const at = { level: plan.pool.view[page], ax: plan.pool.x[page], ay: plan.pool.y[page] };
      assert.ok(
        covers(plan, slice, at, min, max),
        `frame ${frame}: page ${page}, under still casters only, is drawn again`,
      );
      under++;
    }
    assert.ok(under > 0, `frame ${frame}: the pages under the caster are drawn`);
  }
});
