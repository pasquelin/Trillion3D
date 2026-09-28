// #915: twin worlds take the same random moves and edits, one moving by index and subtree, the other
// walking the whole index as before; rows, boxes and declared motion keep the same bits throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { setWebgpuTransform } from './transform.ts';
import { findNode, rootsUnder } from './movedNode.ts';
import { pick, seeded } from '../../../host/world/randomTree.fixture.ts';
import {
  assertSame,
  edit,
  isAncestor,
  world,
  worldPose,
  type World,
} from './transformTwins.fixture.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/** Runs a move; the engine code it was refused with, if any — anything else fails the test. */
function moveBy(x: World, name: string, pose: Float32Array) {
  try {
    setWebgpuTransform(x.rt, name, pose);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!code) throw error;
    return code;
  }
}

/** The roots whose mesh climbs to `node`, in rank order: how a move found them before #915. */
const climbUnder = (roots: World['roots'], node: Object3D) =>
  roots.flatMap((root, i) => (isAncestor(node, root.pages[0].sourceMesh as Object3D) ? [i] : []));

for (const lot of [false, true])
  test(`move by index and subtree: the bits of the whole walk — ${lot ? 'box lot' : 'box by box'}`, async () => {
    for (let seed = 1; seed <= 3; seed++) {
      const twins = [await world(seed, lot, false), await world(seed, lot, true)];
      const [a, b] = twins,
        draw = seeded(seed * 7907 + (lot ? 1 : 0)),
        out: number[] = [];
      let edited = 0;
      for (let step = 0; step < 300; step++) {
        const label = `seed ${seed} step ${step}`;
        // Poses and renames come twice as often as the other edits.
        if (draw() < 0.4) edited = edit(draw, Math.floor(draw() * 8) % 6, twins);
        // Half the moves fall below the node last edited: a pose the host set above them.
        const below: Object3D[] = [];
        a.nodes[edited].traverse((node) => void below.push(node));
        const name = pick(draw, draw() < 0.5 && below.length > 1 ? below.slice(1) : a.nodes).name,
          pose = worldPose(draw);
        const node = G.byName(a.source, name);
        // Identity alone: a failing message would print the whole graph.
        assert.ok(findNode(a.source, name) === node, `${label}: ${name} is not the walk's`);
        if (node)
          assert.deepEqual(rootsUnder(a.roots, node, out), climbUnder(a.roots, node), label);
        assert.equal(moveBy(a, name, pose), moveBy(b, name, pose), label);
        assertSame(a, b, label, false);
        if (draw() < 0.2) {
          a.image();
          b.image();
          assertSame(a, b, `${label} image`, true);
        }
      }
    }
  });
