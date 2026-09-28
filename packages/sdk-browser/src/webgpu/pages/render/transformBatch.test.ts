// #971: three twins take the same random edits and moves: one moves by node handle in batches, one
// moves the same nodes one by one, one moves them one by one passing the whole index each time.
// Rows, boxes, worlds and declared motion keep the same bits, and each local pose set is the one
// the host chain composes (develop's parent world), over host writes, renames and reparenting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix4, multiplyMatrix4 } from '../../../../../sdk-core/src/index.ts';
import { setWebgpuTransform, setWebgpuTransforms } from './transform.ts';
import { findNode } from './movedNode.ts';
import { hostWorldChainInto } from '../../../host/world/chain.ts';
import { pick, seeded, type Draw } from '../../../host/world/randomTree.fixture.ts';
import {
  assertSame,
  edit,
  isAncestor,
  sameBits,
  world,
  worldPose,
  type World,
} from './transformTwins.fixture.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/** The engine code a move was refused with, if any — anything else fails the test. */
function refused(move: () => void) {
  try {
    move();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!code) throw error;
    return code;
  }
}

/** The local pose develop's move set: the request brought into the parent world the chain composes. */
function chainedLocal(node: Object3D, pose: Float32Array) {
  const local = Float64Array.from(pose);
  if (!node.parent) return local;
  const parent = hostWorldChainInto(new Float64Array(16), node.parent);
  multiplyMatrix4(local, invertMatrix4(new Float64Array(16), parent), local);
  return local;
}

/** The moves one by one: by name when the name finds that node, by a handle of one otherwise.
 *  Each pose set is checked against the chain's; stops at the first refusal, returned. */
function oneByOne(x: World, at: readonly number[], poses: Float32Array[], label: string) {
  for (let k = 0; k < at.length; k++) {
    const node = x.nodes[at[k]],
      pose = poses[k],
      expected = chainedLocal(node, pose),
      before = Float64Array.from(node.matrix.elements);
    const code = refused(() =>
      findNode(x.source, node.name) === node
        ? setWebgpuTransform(x.rt, node.name, pose)
        : setWebgpuTransforms(x.rt, [node], pose),
    );
    // A handle outlives nothing: a node no longer under the prepared scene is refused.
    if (!isAncestor(x.source, node)) assert.equal(code, 'UNKNOWN_SCENE_NODE', label);
    if (code) return code;
    const after = Float64Array.from(node.matrix.elements);
    if (!after.every((v, i) => Object.is(v, before[i])))
      sameBits(after, expected, `${label} local`);
  }
}

/** Mobility entries (rank, pose) and motion boxes, apart: a batch reports every root before the boxes. */
function split(log: unknown[]) {
  const moves = log.filter(Array.isArray).map((entry) => JSON.stringify(entry));
  return { boxes: log.filter((entry) => !Array.isArray(entry)), moves };
}

/** Batch against one by one. Disjoint nodes declare the same motion; overlapping ones, where a
 *  root moves twice one by one, leave the same last pose per root. */
function assertBatch(a: World, b: World, disjoint: boolean, label: string) {
  sameBits(a.rows.pageTableFloats, b.rows.pageTableFloats, `${label} rows`);
  sameBits(a.rows.dirty, b.rows.dirty, `${label} dirty`);
  a.roots.forEach((root, i) => sameBits(root.worldBox!, b.roots[i].worldBox!, `${label} box`));
  a.roots.forEach((root, i) =>
    sameBits(
      root.world.elements as Float64Array,
      b.roots[i].world.elements as Float64Array,
      `${label} world`,
    ),
  );
  const [x, y] = [split(a.log), split(b.log)];
  if (disjoint) {
    assert.deepEqual(x.boxes, y.boxes, `${label} motion`);
    assert.deepEqual(x.moves.sort(), y.moves.sort(), `${label} mobility`);
  } else {
    const last = (moves: string[]) => new Map(moves.map((m) => [JSON.parse(m)[0], m]));
    assert.deepEqual(last(x.moves), last(y.moves), `${label} mobility`);
  }
  a.log.length = 0;
}

/** Up to six node ranks, half of them below the node last edited: a pose the host set above them. */
function drawBatch(draw: Draw, nodes: readonly Object3D[], edited: number) {
  const rank = new Map(nodes.map((node, i) => [node, i])),
    below: number[] = [];
  nodes[edited].traverse((node) => void below.push(rank.get(node) ?? -1));
  const count = 1 + Math.floor(draw() * 6);
  return Array.from({ length: count }, () =>
    draw() < 0.5 && below.length > 1
      ? pick(draw, below.slice(1))
      : Math.floor(draw() * nodes.length),
  ).filter((at) => at >= 0);
}

for (const lot of [false, true])
  test(`moves by handle in a batch: the bits of the same moves one by one — ${lot ? 'box lot' : 'box by box'}`, async () => {
    for (let seed = 1; seed <= 2; seed++) {
      const twins = [
        await world(seed, lot, false),
        await world(seed, lot, false),
        await world(seed, lot, true),
      ];
      const [a, b, c] = twins,
        draw = seeded(seed * 104729 + (lot ? 1 : 0));
      let edited = 0;
      for (let step = 0; step < 200; step++) {
        const label = `seed ${seed} step ${step}`;
        if (draw() < 0.4) edited = edit(draw, Math.floor(draw() * 8) % 6, twins);
        const at = drawBatch(draw, a.nodes, edited),
          poses = at.map(() => worldPose(draw)),
          matrices = new Float32Array(at.length * 16);
        poses.forEach((pose, k) => matrices.set(pose, k * 16));
        const disjoint = at.every((p, i) =>
          at.every((q, j) => i === j || !isAncestor(a.nodes[p], a.nodes[q])),
        );
        const handles = at.map((rank) => a.nodes[rank]);
        const code = refused(() => setWebgpuTransforms(a.rt, handles, matrices));
        assert.equal(code, oneByOne(b, at, poses, label), label);
        assert.equal(code, oneByOne(c, at, poses, label), label);
        assertBatch(a, b, disjoint, label);
        assertSame(b, c, label, false);
        if (draw() < 0.2) {
          for (const x of twins) x.image();
          assertBatch(a, b, true, `${label} image`);
          assertSame(b, c, `${label} image`, true);
        }
      }
    }
  });
