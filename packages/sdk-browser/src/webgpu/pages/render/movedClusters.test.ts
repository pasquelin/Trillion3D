// #1345: a ring turning about its own axis — an astrolabe's — declares the boxes its clusters
// cover, where they were and where they land, and none of its hollow, which its box holds whole: a
// shadow page there keeps its depth. Moved as a named node (`setWebgpuTransform`) or as the world
// moves its meshes, by their placement rows (`updateWebgpuPlacements`).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { setWebgpuTransform } from './transform.ts';
import { runtime, scene, selectionRoot } from '../../core/transformShear.fixture.ts';
import { createPlacementRows, placementWorld } from '../../../placement/rows.ts';
import { updateWebgpuPlacements } from '../../../placement/webgpuPlacements.ts';
import type { PageRec } from '../../../page/selection/types.ts';

/** A ring of eight metres lying on the ground, its tube a quarter metre, cut in 26 clusters. */
const RADIUS = 8,
  TUBE = 0.25,
  CLUSTERS = 26,
  REACH = RADIUS + TUBE;
/** A turn by a quarter of a cluster. */
const TURN = new Float32Array(new G.Matrix4().makeRotationY(Math.PI / (2 * CLUSTERS)).elements);

/** Cluster `i`'s box: its arc of the tube, sampled closely enough for a declared box. */
function arc(i: number) {
  const min = [Infinity, -TUBE, Infinity],
    max = [-Infinity, TUBE, -Infinity];
  for (let k = 0; k <= 16; k++) {
    const angle = ((i + k / 16) * 2 * Math.PI) / CLUSTERS;
    for (const r of [RADIUS - TUBE, RADIUS + TUBE]) {
      const [x, z] = [r * Math.cos(angle), r * Math.sin(angle)];
      [min[0], max[0]] = [Math.min(min[0], x), Math.max(max[0], x)];
      [min[2], max[2]] = [Math.min(min[2], z), Math.max(max[2], z)];
    }
  }
  return { min, max };
}
const clusters = (sourceMesh?: object) =>
  Array.from(
    { length: CLUSTERS },
    (_, i) => ({ sourceMesh, level: 0, ...arc(i) }) as unknown as PageRec,
  );

/** The ring turned as a named node: what it declares. */
function turnNode() {
  const { source, mesh, worlds } = scene('ring'),
    root = selectionRoot(mesh, [-REACH, -TUBE, -REACH, REACH, TUBE, REACH], worlds);
  Object.assign(root, { pages: clusters(mesh), boxes: true });
  const { rt, motions } = runtime(source, [root], worlds);
  rt.lights.mobility.ensure(1, 1, () => root.world.elements);
  setWebgpuTransform(rt, 'ring', TURN);
  return motions;
}

/** The ring placed by its placement row, as the world places a mesh, shown and unmoved: its rows,
 *  its runtime and what it declares. */
function ringOnRow() {
  const rows = createPlacementRows(1);
  rows.matrices.set(new G.Matrix4().elements);
  rows.live[0] = 1;
  const root = selectionRoot(new G.Object3D(), [-REACH, -TUBE, -REACH, REACH, TUBE, REACH], {
    of: () => placementWorld(rows, 0),
  } as never);
  Object.assign(root, { pages: clusters(), boxes: true, placement: { rows, index: 0 } });
  const { rt, motions } = runtime(new G.Object3D(), [root]);
  Object.assign(rt.blendState, { blendGpu: [] });
  rt.lights.mobility.ensure(1, 1, () => root.world.elements);
  return { rows, rt, motions };
}

/** The ring turned by its placement row, as the world moves a mesh: what it declares. */
function turnRow() {
  const { rows, rt, motions } = ringOnRow();
  rows.matrices.set(TURN);
  updateWebgpuPlacements(rt, rows, 0, 0);
  return motions;
}

/** The ring hidden, then shown again, where it lies, by its placement row (#831): what each
 *  declares — a mesh the world shows or hides at a fixed pose, a frame of wax in a lava lamp. */
function flipRow() {
  const { rows, rt, motions } = ringOnRow();
  const declared: (typeof motions)[] = [];
  for (const live of [0, 1]) {
    rows.live[0] = live;
    updateWebgpuPlacements(rt, rows, 0, 0);
    declared.push(motions.splice(0));
  }
  return declared;
}

test('a ring hidden or shown where it lies declares its clusters, static, never its hollow', () => {
  for (const motions of flipRow()) {
    assert.equal(motions.length, CLUSTERS, 'a box per cluster');
    assert.ok(
      motions.every(({ movingOnly }) => !movingOnly),
      'the static slice held it',
    );
    const declared = (x: number, z: number) =>
      motions.some(
        ({ min, max }) => min[0] <= x && x <= max[0] && min[2] <= z && z <= max[2] && min[1] <= 0,
      );
    for (const [x, z] of [
      [RADIUS, 0.5],
      [-0.5, -RADIUS],
    ])
      assert.ok(declared(x, z), `the ring at ${x}, ${z}`);
    for (const [x, z] of [
      [0, 0],
      [2, 1],
    ])
      assert.ok(!declared(x, z), `the hollow at ${x}, ${z}`);
  }
});

for (const [path, turn] of [
  ['a named node', turnNode],
  ['a placement row', turnRow],
] as const)
  test(`a turning ring declares the boxes of its clusters, never its hollow — ${path}`, () => {
    const motions = turn();
    assert.equal(motions.length, CLUSTERS, 'a box per cluster, where it was and lands');
    /** Whether a declared box holds the ground point `x, z`. */
    const declared = (x: number, z: number) =>
      motions.some(
        ({ min, max }) => min[0] <= x && x <= max[0] && min[2] <= z && z <= max[2] && min[1] <= 0,
      );
    // Under the ring, on each side: declared.
    for (const [x, z] of [
      [RADIUS, 0.5],
      [-RADIUS, -0.5],
      [0.5, RADIUS],
      [-0.5, -RADIUS],
    ])
      assert.ok(declared(x, z), `the ring at ${x}, ${z}`);
    // In the hollow the ring's box holds: never declared.
    for (const [x, z] of [
      [0, 0],
      [2, 1],
      [-2, 2],
      [1, -3],
    ])
      assert.ok(!declared(x, z), `the hollow at ${x}, ${z}`);
  });
