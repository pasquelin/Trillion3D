// #972: WebGL2 gains a move by name. The node the name index finds is posed as WebGPU's move poses
// it (`poseNode`), the frame gate hears the move, and the next image's world pass leaves the
// engine's worlds bit-identical to the same local poses written by the host, over random hierarchies
// and hostile poses; an unknown name or a bad pose is refused by the same codes as on WebGPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { invertMatrix4, multiplyMatrix4 } from '../../../sdk-core/src/index.ts';
import { autonomousPlacements } from './autonomousPlacements.ts';
import { createWebglFrameGate } from '../webgl/core/frameGate.ts';
import { hostWorldPlacements } from '../host/world/placements.ts';
import { hostWorldChainInto } from '../host/world/chain.ts';
import { randomTree, seeded, pick } from '../host/world/randomTree.fixture.ts';
import { worldPose } from '../webgpu/pages/render/transformTwins.fixture.ts';
import { HOSTILE_FLOATS } from '../../../../tests/kit/assert/hostile.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

/** The WebGL2 scene updates on `source`, with the frame gate and the engine index they drive. */
function webgl(source: Object3D) {
  const gate = createWebglFrameGate(),
    worlds = hostWorldPlacements(source);
  const env = { context: { source }, gate, geometryStore: {} };
  const updates = autonomousPlacements(
    env as unknown as Parameters<typeof autonomousPlacements>[0],
  );
  return { gate, worlds, updates };
}

/** The local pose a host writes for `node` to stand at `pose`: brought into its parent's world. */
function hostLocal(node: Object3D, pose: Float32Array) {
  const local = Float64Array.from(pose),
    parent = hostWorldChainInto(new Float64Array(16), node.parent!);
  return multiplyMatrix4(local, invertMatrix4(new Float64Array(16), parent), local);
}

test('a move by name on WebGL2: the worlds of the same local poses written by the host', () => {
  const draw = seeded(972);
  const [a, b] = [0, 1].map(() => randomTree(seeded(51), 400, 200));
  const [x, y] = [webgl(a.source), webgl(b.source)];
  let moves = 0;
  for (let step = 0; step < 300; step++) {
    const at = 1 + Math.floor(draw() * (a.nodes.length - 1)),
      node = a.nodes[at],
      twin = b.nodes[at],
      pose = worldPose(draw);
    if (draw() < 0.05) pose[Math.floor(draw() * 12)] = pick(draw, HOSTILE_FLOATS.slice(0, 2));
    // The name index answers the first node of its name, in prefix order: that one is moved.
    if (G.byName(a.source, node.name) !== node) continue;
    moves++;
    const local = hostLocal(twin, pose);
    x.updates.setTransform!(node.name, pose);
    twin.matrixAutoUpdate = false;
    twin.matrix.fromArray(local);
    y.gate.sceneChanged();
    for (const { gate, worlds } of [x, y]) assert.ok(gate.updateWorlds(worlds), 'a world pass');
    assert.deepEqual(Array.from(node.matrix.elements), Array.from(twin.matrix.elements));
    a.nodes.forEach((n, i) =>
      assert.deepEqual(x.worlds.of(n).elements, y.worlds.of(b.nodes[i]).elements, `step ${step}`),
    );
  }
  assert.ok(moves > 100, `${moves} moves`);
});

test('an unknown name, a pose of fifteen floats, a NaN: refused by their codes', () => {
  const { source } = randomTree(seeded(3), 20, 10);
  const { updates, gate, worlds } = webgl(source);
  gate.updateWorlds(worlds);
  const code = (move: () => void) => {
    try {
      move();
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };
  const pose = new Float32Array(new G.Matrix4().elements);
  assert.equal(
    code(() => updates.setTransform!('nobody', pose)),
    'UNKNOWN_SCENE_NODE',
  );
  assert.equal(
    code(() => updates.setTransform!('n1', pose.subarray(1))),
    'INVALID_TRANSFORM',
  );
  assert.equal(
    code(() =>
      updates.setTransform!(
        'n1',
        pose.map(() => NaN),
      ),
    ),
    'NON_FINITE_TRANSFORM',
  );
  assert.equal(gate.updateWorlds(worlds), false, 'nothing moved, no world pass');
});
