// A linked row's world sphere, what the shadow cull drops a row by, follows its parent's move on
// the GPU: the compose rows pass (`composeSphere`, the shipped WGSL) writes it from the composed
// world and the row's local box, around the sphere the CPU writes at that world
// (`../webgpu/shadow/spheres.ts`), and writes none while no light casts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { packClusterSpheres } from '../webgpu/shadow/spheres.ts';
import { CLUSTER_SPHERE_FLOATS } from '../webgpu/shadow/rowBuffers.ts';
import type { PageRec } from '../page/selection/selection.ts';
import type { Placements } from '../page/selection/placements.ts';
import { composeRows, cpuTable, crystals, N } from './gpuComposeRows.fixture.ts';

test("a linked row's world sphere follows its parent's turn on the GPU, around the CPU's", () => {
  const { group, meshes, settle } = crystals();
  settle();
  const locals = meshes.map((mesh) => mesh._matrixElements.slice());
  // Each row's local box as the spheres' upload keeps it: centre, then half extent.
  const half = 0.05,
    boxes = new Float64Array(N * 6);
  for (let row = 0; row < N; row++) boxes.fill(half, row * 6 + 3, row * 6 + 6);
  const recs = meshes.map(() => ({ min: [-half, -half, -half], max: [half, half, half] }));
  const cpuSpheres = () =>
    packClusterSpheres(
      recs as unknown as PageRec[],
      meshes.map((mesh) => ({ world: { elements: mesh.matrixWorld.elements } })) as unknown as Placements,
      new Float32Array(N * CLUSTER_SPHERE_FLOATS),
      0,
      N - 1,
      (row) => row,
    );
  const before = cpuSpheres();
  // The parent turns and moves on the GPU alone: no CPU row write, no CPU sphere.
  group.rotation.y = -0.7;
  group.position.set(3, -1, 2);
  settle();
  const cpu = cpuSpheres(),
    out = Array.from(before);
  composeRows(cpuTable(meshes), group.matrixWorld.elements, locals, { out, boxes, cast: true });
  for (let row = 0; row < N; row++) {
    const s = row * CLUSTER_SPHERE_FLOATS,
      gap = Math.hypot(
        ...[0, 1, 2].map((axis) => out[s + axis] + out[s + 4 + axis] - (cpu[s + axis] + cpu[s + 4 + axis])),
      ),
      left = Math.hypot(
        ...[0, 1, 2].map((axis) => out[s + axis] + out[s + 4 + axis] - (before[s + axis] + before[s + 4 + axis])),
      );
    assert.ok(left > 0.5, `row ${row}: the sphere left the pose of the last CPU write`);
    assert.ok(gap < 1e-12, `row ${row}: its centre is the CPU's at the composed world, ${gap} off`);
    assert.ok(out[s + 3] >= cpu[s + 3] + gap, `row ${row}: it holds the CPU's sphere`);
    assert.ok(out[s + 3] <= cpu[s + 3] * (1 + 1e-5), `row ${row}: and no more than a rounding past it`);
    assert.equal(out[s + 7], 0);
  }
  // No light casts: the pass leaves every sphere as it was.
  const untouched = Array.from(before);
  composeRows(cpuTable(meshes), group.matrixWorld.elements, locals, {
    out: untouched,
    boxes,
    cast: false,
  });
  assert.deepEqual(untouched, Array.from(before));
});
