// Top-down pruning drops no cluster the cut would have taken, on the GPU. The subtree error floor
// that `packCullingNodes` stores and `errorFloor` projects in WGSL is a lower bound of the
// projected error of the whole subtree: an overestimated one silently drops geometry. The CPU
// works in f64 on the packed values, the kernel in f32: that gap is what this measures.
//
// Three cuts on an eight-level pyramid under five poses: the CPU cut (`selectVisiblePages`), the
// kernel's Node oracle, and the WGSL kernel. Same pages, same triangle totals, the same request
// priorities in the same order; and every pose prunes, or the proof would cover nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { selectVisiblePages } from '../../../packages/sdk-browser/src/page/cut/cut.ts';
import { cullingBounds } from '../../../packages/sdk-browser/src/page/cut/bounds.ts';
import { descenteComptee } from '../../../packages/sdk-browser/src/gpu/dag/cutFrontier.fixture.ts';
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts';
import { requestPriority } from '../../../packages/sdk-browser/src/gpu/dag/request.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts';
import { runSelectionKernel } from './selectionKernel.ts';
import { posedSelection } from './selectionCase.ts';

const VIEWPORT: [number, number] = [1280, 720];
/**
 * Name, camera x and z, threshold, and the depths the pyramid is placed at. One depth keeps one
 * level, hence one priority: placed far apart, the copies resolve to different levels and the
 * priority sequence has several steps to compare.
 */
const POSES: Array<[string, number, number, number, number[]]> = [
  ['head-on, 1 px', 0, 16, 1, [0]],
  ['head-on, 4 px', 0, 16, 4, [0]],
  ['oblique, 1 px', 9, 14, 1, [0]],
  ['from afar, 0.25 px', 0, 60, 0.25, [0]],
  ['four depths, 1 px', 0, 16, 1, [0, 12, 30, 70]],
];

test('the GPU cut, its oracle and the CPU cut agree while every pose prunes', async () => {
  const pages = scenePages(4096, 8);
  const camera = G.perspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200);
  const cases = POSES.map(([name, x, z, threshold, depths]) => {
    const worlds = depths.map((depth) => new G.Matrix4().makeTranslation(0, 0, -depth));
    const roots = sceneRoots(pages, worlds);
    const { packed, uniforms } = posedSelection(camera, [x, z, threshold], VIEWPORT, roots);
    // The CPU cut walks the same nodes with its own bounds, in f64: the reference.
    const culling = roots[0].culling;
    assert.ok(culling, 'the scene root carries no culling nodes');
    const bounds = cullingBounds(culling, pages);
    const cpu = selectVisiblePages(
      worlds.map((world) => ({ world, pages, cones: false, culling: { ...culling, bounds } })),
      cameraMoteur(camera),
      { pixelError: threshold, viewport: VIEWPORT },
    );
    return {
      name,
      packed,
      uniforms,
      cpu: cpu.shown.length,
      pruned: descenteComptee(packed, uniforms, true).plancherCoupe,
      oracle: evaluateDagSelectionKernel(packed, uniforms),
    };
  });
  const { adapter, readings } = await runSelectionKernel(cases);
  const rows = cases.map((c, k) => ({
    ...c,
    gpu: readings[k],
    priorities: readings[k].requests.map(requestPriority),
  }));
  console.log(
    JSON.stringify({
      adapter,
      pages: pages.length,
      rows: rows.map(({ name, pruned, cpu, gpu, priorities }) => ({
        name,
        pruned,
        cpu,
        gpu: gpu.pages.length,
        prioritySteps: new Set(priorities).size,
      })),
    }),
  );
  // On a constant sequence, equal priorities would say nothing.
  assert.ok(
    rows.some(({ priorities }) => new Set(priorities).size > 1),
    'no pose carries more than one priority step',
  );
  for (const { name, pruned, cpu, oracle, gpu, priorities } of rows) {
    assert.ok(pruned > 0, `${name}: no subtree pruned`);
    assert.equal(gpu.pages.length, oracle.pageIds.length, `${name}: GPU and oracle diverge`);
    assert.equal(gpu.pages.length, cpu, `${name}: the GPU loses from the cut`);
    assert.ok(gpu.selectedTriangles > 0, `${name}: no triangle counted`);
    assert.equal(gpu.selectedTriangles, oracle.selectedTriangles, `${name}: totals diverge`);
    // Each request's priority decides which page the host uploads first.
    assert.deepEqual(priorities, oracle.requestPriorities, `${name}: priorities diverge`);
  }
});
