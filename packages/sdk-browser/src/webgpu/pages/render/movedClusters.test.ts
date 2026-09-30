// #1345: a ring turning about its own axis — an astrolabe's — stales the shadow pages its clusters
// cover, where they were and where they land, and none of its hollow, which its box holds whole: a
// page there keeps its depth. Moved as a named node (`setWebgpuTransform`) or as the world moves
// its meshes, by their placement rows (`updateWebgpuPlacements`); what it declares stales a real
// plan's pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { setWebgpuTransform } from './transform.ts';
import { runtime, scene, selectionRoot } from '../../core/transformShear.fixture.ts';
import { createPlacementRows, placementWorld } from '../../../placement/rows.ts';
import { updateWebgpuPlacements } from '../../../placement/webgpuPlacements.ts';
import {
  SUN_GRID,
  cycle,
  planFrame,
  staleEntries,
  sunPages,
  sunScene,
} from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { sunPageMetres } from '../../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
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
    (_, i) => ({ sourceMesh, packedIndex: i, level: 0, ...arc(i) }) as unknown as PageRec,
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

/** The ring turned by its placement row, as the world moves a mesh: what it declares. */
function turnRow() {
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
  rows.matrices.set(TURN);
  updateWebgpuPlacements(rt, rows, 0, 0);
  return motions;
}

for (const [path, turn] of [
  ['a named node', turnNode],
  ['a placement row', turnRow],
] as const)
  test(`a turning ring stales the pages under its clusters, never its hollow's — ${path}`, () => {
    const motions = turn();
    assert.equal(motions.length, CLUSTERS, 'a box per cluster, where it was and lands');
    const { store, plan, slice } = sunScene();
    // Two-metre pages over the ring and round it, all drawn.
    let level = plan.sun.finest[slice];
    while (sunPageMetres(level) < 2) level++;
    const size = sunPageMetres(level),
      read = () => sunPages(plan, slice, level, SUN_GRID);
    for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, read);
    assert.deepEqual(staleEntries(plan), [], 'every page read is drawn');
    for (const { min, max, movingOnly } of motions) plan.worldChanged(min, max, movingOnly);
    planFrame(plan, store, 4);
    const f = slice * 9,
      frame = plan.sun.frame;
    const pageAt = (x: number, z: number) => {
      const u = frame[f] * x + frame[f + 2] * z,
        v = -(frame[f + 3] * x + frame[f + 5] * z);
      return sunPages(plan, slice, level, [[Math.floor(u / size), Math.floor(v / size)]])[0];
    };
    const stale = new Set(staleEntries(plan));
    // Under the ring, on each side: drawn again.
    for (const [x, z] of [
      [RADIUS, 0.5],
      [-RADIUS, -0.5],
      [0.5, RADIUS],
      [-0.5, -RADIUS],
    ])
      assert.ok(stale.has(pageAt(x, z)), `the page under the ring at ${x}, ${z}`);
    // In the hollow the ring's box holds: kept.
    for (const [x, z] of [
      [0, 0],
      [2, 1],
      [-2, 2],
      [1, -3],
    ])
      assert.ok(!stale.has(pageAt(x, z)), `the hollow's page at ${x}, ${z}`);
    assert.ok(stale.size < read().length / 2, `${stale.size} pages of ${read().length}`);
  });
