// #525: a written range of placement rows stales only what moved in it. The world hands each
// instance buffer's written span once (`world/core/worldPoses.ts`): a row of it left where it
// stands — a still mesh between two written ones, a sleeping wheel posed again in place — is no
// move, and two roots that moved are two boxes, never the room between them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boxTransform } from '../../../sdk-core/src/index.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/math/matrix/matrix4.ts';
import * as light from '../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import * as sun from '../../../sdk-core/src/scene/light-shadow/sunView.fixture.ts';
import { createShadowMobility } from '../webgpu/shadow/mobility.ts';
import { createPlacementRows, placementWorld } from './rows.ts';
import { followPlacementRows } from './update.ts';

/** A small caster, the ground under it, a box far off: local boxes, placed at the origin. */
const BOXES = [
  [-0.1, 0, -0.1, 0.1, 0.2, 0.1],
  [-5, -0.1, -5, 5, 0, 5],
  [20, 0, 20, 21, 1, 21],
];

/** The three placements, rows of one buffer; the writer moves rows along x and hands the whole
 *  span as written, each moved root's box to `touched`. */
function placed() {
  const rows = createPlacementRows(BOXES.length);
  const roots = BOXES.map((local, index) => {
    rows.matrices.set(IDENTITY_MATRIX4, index * 16);
    rows.live[index] = 1;
    const world = placementWorld(rows, index),
      worldBox = new Float64Array(6),
      localBox = Float64Array.from(local);
    boxTransform(worldBox, 0, localBox, 0, world.elements);
    return { pages: [], world, localBox, worldBox, placement: { rows, index } };
  });
  const mobility = createShadowMobility();
  mobility.ensure(roots.length, 1, (rank) => roots[rank].world.elements);
  return (moves: number[][], touched: (min: number[], max: number[]) => void) => {
    for (const [index, x] of moves) rows.matrices[index * 16 + 12] = x;
    const last = BOXES.length - 1;
    return followPlacementRows(
      roots as never,
      rows,
      0,
      last,
      undefined,
      mobility.move,
      undefined,
      touched,
    );
  };
}

test('a written range stales each root that moved, apart, and none left where it stands', () => {
  const write = placed(),
    boxes: number[][] = [];
  const collect = (min: number[], max: number[]) => boxes.push([...min, ...max]);
  assert.equal(
    write(
      [
        [0, 0.1],
        [2, 1],
      ],
      collect,
    ),
    true,
  );
  assert.deepEqual(boxes, [
    [-0.1, 0, -0.1, 0.2, 0.2, 0.1],
    [20, 0, 20, 22, 1, 21],
  ]);
  boxes.length = 0;
  assert.equal(write([[0, 0.1]], collect), false, 'written again where it stands: no move');
  assert.deepEqual(boxes, []);
});

test('a caster moving over a still ground, under a moving camera, redraws the pages it sweeps', () => {
  const { store, plan, slice } = light.sunScene();
  const named = sun.sunBlock(plan, slice, [3, 4, 5], [0, 5, 0], 8),
    read = () => sun.entriesOf(plan, slice, named);
  for (let frame = 1; frame < 4; frame++)
    light.cycleDrawn(plan, store, frame, read, light.nudged(frame));
  const write = placed(),
    current = new Set<number>();
  for (let frame = 4, was = 0; frame < 16; frame++) {
    const x = frame * 0.02,
      // The caster's own swept box, where it was and where it is.
      min = [was - 0.1, 0, -0.1],
      max = [x + 0.1, 0.2, 0.1];
    was = x;
    let boxes = 0;
    write([[0, x]], (lo, hi) => {
      boxes++;
      plan.worldChanged(lo, hi);
    });
    assert.equal(boxes, 1, `frame ${frame}: the caster alone moved`);
    current.clear();
    for (let page = 0; page < plan.pool.pages; page++)
      if (plan.pool.owner[page] >= 0 && plan.pool.valid[page] && !plan.pool.dirty[page])
        current.add(page);
    let under = 0;
    for (const page of light.cycleDrawn(plan, store, frame, read, light.nudged(frame))) {
      if (!current.has(page) || plan.records.isFloor(page)) continue;
      const at = { level: plan.pool.view[page], ax: plan.pool.x[page], ay: plan.pool.y[page] };
      assert.ok(sun.covers(plan, slice, at, min, max), `frame ${frame}: page ${page} drawn again`);
      under++;
    }
    assert.ok(under > 0, `frame ${frame}: the pages under the caster are drawn`);
  }
});
