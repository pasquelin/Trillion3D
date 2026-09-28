// #915, #971: three twins take the same random edits and moves: one moves by node handle in
// batches, one moves the same nodes one by one, one moves them one by one passing the whole index
// each time. Rows, boxes, worlds and declared motion keep the same bits, each local pose set is the
// one the host chain composes (develop's parent world), and the name index and subtree walk answer
// as the whole walks did, over host writes, renames, additions, removals and reparenting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix4, multiplyMatrix4 } from '../../../../../sdk-core/src/index.ts';
import { setWebgpuTransform, setWebgpuTransforms } from './transform.ts';
import * as G from '../../../host/graph/graph.fixture.ts';
import { appendRootsUnder, findNode } from './movedNode.ts';
import { HOSTILE_FLOATS } from '../../../../../../tests/kit/assert/hostile.ts';
import { hostWorldChainInto } from '../../../host/world/chain.ts';
import { pick, seeded, type Draw } from '../../../host/world/randomTree.fixture.ts';
import {
  assertSame,
  edit,
  isAncestor,
  sameBits,
  sameState,
  takeFinalRows,
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

/** The roots whose mesh climbs to `node`, in rank order: how a move found them before #915. */
const climbUnder = (roots: World['roots'], node: Object3D) =>
  roots.flatMap((root, i) => (isAncestor(node, root.pages[0].sourceMesh as Object3D) ? [i] : []));

/** Mobility entries (rank, pose) and motion boxes, apart: a batch reports every root before the boxes. */
function split(log: unknown[]) {
  const moves = log.filter(Array.isArray).map((entry) => JSON.stringify(entry));
  return { boxes: log.filter((entry) => !Array.isArray(entry)), moves };
}

/** Batch against one by one. Disjoint nodes declare the same motion; overlapping ones, where a
 *  root moves twice one by one, leave the same last pose per root. Roots moved through a link the
 *  host has since cut are taken at their final row first (`takeFinalRows`). */
function assertBatch(a: World, b: World, c: World, disjoint: boolean, label: string) {
  const taken = takeFinalRows(a, b, [c]);
  sameState(a, b, label, true);
  const [x, y] = [split(a.log), split(b.log)];
  const last = (moves: string[]) =>
    new Map(moves.map((m) => [JSON.parse(m)[0], m]).filter(([rank]) => !taken.has(rank)));
  if (disjoint && !taken.size) {
    assert.deepEqual(x.boxes, y.boxes, `${label} motion`);
    assert.deepEqual(x.moves.sort(), y.moves.sort(), `${label} mobility`);
  } else {
    assert.deepEqual(last(x.moves), last(y.moves), `${label} mobility`);
    // A root under two moved nodes moves once, and its first move still stales the static layer.
    const ranks = x.moves.map((m) => JSON.parse(m)[0]);
    assert.equal(new Set(ranks).size, ranks.length, `${label} one move per root`);
    const whole = (boxes: unknown[]) =>
      boxes.some((box) => !(box as { movingOnly: boolean }).movingOnly);
    if (whole(y.boxes)) assert.ok(whole(x.boxes), `${label} static layer`);
  }
  a.log.length = 0;
}

/** Up to six node ranks, half of them below the node last edited: a pose the host set above them;
 *  now and then none, or — `maximal` — every node the prepared scene holds. */
function drawBatch(draw: Draw, x: World, edited: number, maximal: boolean) {
  const { nodes, source } = x,
    roll = draw();
  if (roll < 0.02) return [];
  if (maximal && roll > 0.998)
    return nodes.flatMap((node, i) => (isAncestor(source, node) ? [i] : []));
  const rank = new Map(nodes.map((node, i) => [node, i])),
    below: number[] = [];
  nodes[edited].traverse((node) => void below.push(rank.get(node) ?? -1));
  return Array.from({ length: 1 + Math.floor(draw() * 6) }, () =>
    draw() < 0.5 && below.length > 1
      ? pick(draw, below.slice(1))
      : pick(draw, nodes.keys().toArray()),
  ).filter((at) => at >= 0);
}

/** A world pose; one in twenty carries a hostile number (NaN, ±0, ±Inf, a subnormal). */
function drawPose(draw: Draw) {
  const pose = worldPose(draw);
  if (draw() < 0.05) pose[Math.floor(draw() * 16)] = pick(draw, HOSTILE_FLOATS);
  return pose;
}

/** `steps` random edits and batches on three twins; returns the poses requested. */
async function twinRun(seed: number, lot: boolean, steps: number, maximal = false) {
  const twins = [
    await world(seed, lot, false),
    await world(seed, lot, false),
    await world(seed, lot, true),
  ];
  const [a, b, c] = twins,
    draw = seeded(seed * 104729 + (lot ? 1 : 0));
  let edited = 0,
    requested = 0;
  for (let step = 0; step < steps; step++) {
    const label = `seed ${seed} step ${step}`;
    if (draw() < 0.4) edited = edit(draw, Math.floor(draw() * 8) % 6, twins);
    const at = drawBatch(draw, a, edited, maximal),
      poses = at.map(() => drawPose(draw)),
      matrices = new Float32Array(at.length * 16);
    requested += at.length;
    poses.forEach((pose, k) => matrices.set(pose, k * 16));
    const disjoint = at.every((p, i) =>
      at.every((q, j) => i === j || !isAncestor(a.nodes[p], a.nodes[q])),
    );
    const handles = at.map((rank) => a.nodes[rank]);
    // Identity alone: a failing message would print the whole graph.
    const name = handles[0]?.name ?? '',
      named = G.byName(a.source, name);
    assert.ok(findNode(a.source, name) === named, `${label}: ${name} is not the walk's`);
    if (named) {
      const out: number[] = [];
      out.length = appendRootsUnder(a.roots, named, out, 0);
      assert.deepEqual(
        out.sort((p, q) => p - q),
        climbUnder(a.roots, named),
        label,
      );
    }
    const code = refused(() => setWebgpuTransforms(a.rt, handles, matrices));
    assert.equal(code, oneByOne(b, at, poses, label), label);
    assert.equal(code, oneByOne(c, at, poses, label), label);
    assertBatch(a, b, c, disjoint, label);
    assertSame(b, c, label, false);
    if (draw() < 0.2) {
      for (const x of twins) x.image();
      assertBatch(a, b, c, true, `${label} image`);
      assertSame(b, c, `${label} image`, true);
    }
  }
  return requested;
}

for (const lot of [false, true])
  test(`moves by handle in a batch: the bits of the same moves one by one — ${lot ? 'box lot' : 'box by box'}`, async () => {
    for (let seed = 1; seed <= 3; seed++) await twinRun(seed, lot, 200);
  });

test('one long seeded run: over ten thousand poses, hostile, empty and maximal batches', async () => {
  assert.ok((await twinRun(7, false, 2500, true)) >= 10_000);
});
