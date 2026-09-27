// A move reads its node from the name index, visits only the roots under it and refreshes only its
// subtree (#915). Against a reference computed apart — a fresh world index built on the same host
// poses, the roots found by climbing each mesh's chain, the boxes by `boxTransform` — every root's
// world matrix, world box and the declared motion box keep the bits a move gave before, on random
// trees, with host writes between moves, through the box lot and box by box.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as G from '../../../host/graph/graph.fixture.ts';
import {
  BOX_VALUES,
  boxEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts';
import { setWebgpuTransform } from './transform.ts';
import { racine, runtime } from '../../core/transformShear.fixture.ts';
import { hostWorldPlacements } from '../../../host/world/placements.ts';
import {
  climbUnder,
  drawPose,
  pick,
  randomTree,
  seeded,
  type Draw,
} from '../../../host/world/randomTree.fixture.ts';
import { prepareSdkWasm } from '../../../page/decode/geometryPageWasm.ts';
import { reserveRootBoxes } from '../../../math/batchBoxes.ts';
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts';

await prepareSdkWasm(
  readFileSync(join(import.meta.dirname, '../../../page/decode/pageCodec.wasm')),
);

/** A world pose drawn at random: translation, one of a few turns, a positive scale. */
function worldPose(draw: Draw) {
  const turn = new G.Quaternion(draw() - 0.5, draw() - 0.5, draw() - 0.5, draw() + 0.1).normalize();
  const at = new G.Vector3(draw() * 20 - 10, draw() * 20 - 10, -0),
    scale = new G.Vector3(0.5 + draw(), 0.5 + draw(), 0.5 + draw());
  return new Float32Array(new G.Matrix4().compose(at, turn, scale).elements);
}

/** Runs a move; false when it was refused for a singular parent. */
function moves(move: () => void) {
  try {
    move();
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'SINGULAR_PARENT_TRANSFORM') return false;
    throw error;
  }
}

for (const lot of [false, true])
  test(`a move keeps the bits of worlds, boxes and motion box — ${lot ? 'box lot' : 'box by box'}`, async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const draw = seeded(seed * 104729 + (lot ? 1 : 0));
      const { source, nodes } = randomTree(draw, 20 + Math.floor(draw() * 60));
      // One name per node: the move below names the node it means.
      nodes.forEach((node, i) => (node.name = `node${i}`));
      const worlds = hostWorldPlacements(source);
      const meshes = nodes.filter((node) => node instanceof G.Mesh);
      const roots = meshes.map((mesh) => {
        const low = [draw() - 1, draw() - 1, draw() - 1];
        return racine(mesh, [...low, low[0] + 2 * draw(), low[1] + draw(), low[2] + 3], worlds);
      });
      const { rt, layout, run, mouvements } = runtime(source, roots, worlds);
      if (lot) Object.assign(layout, { rootBoxes: await reserveRootBoxes(roots) });
      const drawn = roots.map((root) => root.pages[0]);
      run.gate.readScene(source, drawn);
      run.gate.updateWorlds(worlds);
      const expected = new Float64Array(BOX_VALUES);
      for (let step = 0; step < 15; step++) {
        // Between two moves the host may write a pose itself: the move then walks the whole index.
        if (draw() < 0.3) drawPose(draw, pick(draw, nodes));
        const node = draw() < 0.1 ? source : pick(draw, nodes);
        const under = climbUnder(roots, node);
        boxEmpty(expected, 0);
        for (const i of under) boxUnionBatch(expected, roots[i].worldBox!, 1);
        const count = mouvements.length;
        // A parent the host flattened refuses the move before it writes anything, as before.
        if (!moves(() => setWebgpuTransform(rt, node.name, worldPose(draw)))) continue;
        const fresh = hostWorldPlacements(source);
        for (const i of under) {
          const label = `seed ${seed} step ${step} root ${i}`;
          assertBits(roots[i].world.elements, fresh.of(meshes[i]).elements, label);
          const box = new Float64Array(BOX_VALUES);
          boxTransform(box, 0, roots[i].localBox!, 0, roots[i].world.elements);
          assertBits(roots[i].worldBox!, box, label);
          boxUnionBatch(expected, box, 1);
        }
        if (mouvements.length > count) {
          const { min, max } = mouvements[count];
          assertBits([...min, ...max], expected, `seed ${seed} step ${step} motion box`);
        }
        // An image between moves, now and then: it reads the host and walks what it owes, after
        // which every root stands where a whole walk puts it.
        if (draw() < 0.5) {
          run.gate.readScene(source, drawn);
          run.gate.updateWorlds(worlds);
          const walked = hostWorldPlacements(source);
          roots.forEach((root, i) =>
            assertBits(root.world.elements, walked.of(meshes[i]).elements, `seed ${seed} image`),
          );
        }
      }
    }
  });
