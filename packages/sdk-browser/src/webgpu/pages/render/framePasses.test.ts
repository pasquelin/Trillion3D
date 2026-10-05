// What a steady visibility image encodes outside its render passes, on the device double that
// records every command opening an encoder of its own (`mockGpu().commands`): each compute step
// between two render passes is ONE compute pass, and none is cut by a buffer clear. A pass that
// ends and a clear that starts each cost the frame an encoder change: the partition and the draw
// compaction share a pass, so do the Hi-Z pyramid, its test and the tested half's compaction, and
// so do the material cache and the tile classification, each clearing what it counts by its own
// first dispatch. The GPU cut arms its indirect arguments in its own pass: one pass, no copy
// before the readback's. And a uniform whose words did not change is not sent again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { occluderScene, preparedOccluderRun } from '../testOccluder.fixture.ts';
import { DEFAULT_SCOPE, type ClusterManifest } from '../../../../../sdk-core/src/index.ts';
import {
  HIZ_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SURFACES_PASS,
  PARTITION_PASS,
} from '../../../stage/passLabels.ts';
import type { WebgpuPagesBackend } from '../runtime.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { camera, quadScene } from '../testScenes.fixture.ts';

test('each compute step of a visibility image is one pass, and nothing clears between them', async () => {
  installGpuGlobals();
  const gpu = mockGpu({ compute: true });
  const scene = occluderScene();
  const metadata: ClusterManifest = {
    schema: 0,
    status: 'ready',
    key: 'test-occluder',
    scope: DEFAULT_SCOPE,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    ...scene.metadata,
  };
  const collected = collectClusterPages(scene.source, metadata, scene.indices, scene.associations);
  const run = await preparedOccluderRun(scene, metadata, collected.roots, gpu.device, [32, 32]);
  const backend = run.backend as WebgpuPagesBackend;
  backend.render(run.cam);
  await backend.flush();
  gpu.commands.length = 0;
  backend.render(run.cam);
  const frame = gpu.commands.slice();
  // Up to the material surfaces: the visibility buffer and what the resolve reads.
  const visibility = frame.slice(0, frame.indexOf(`render ${MATERIAL_SURFACES_PASS}`));
  assert.deepEqual(visibility, [
    `compute ${PARTITION_PASS}`,
    'render Trillion3D visibility primary',
    `compute ${HIZ_PASS}`,
    'render Trillion3D visibility secondary',
    `compute ${MATERIAL_COMPUTE_PASS}`,
  ]);
  assert.equal(frame.filter((command) => command === 'clear').length, 0, frame.join(', '));
  backend.dispose();
  scene.geometry.dispose();
  scene.material.dispose();
});

test('the GPU cut is one compute pass, its arguments armed inside it, before the partition', async () => {
  installGpuGlobals();
  const fixture = quadScene();
  const { source, metadata, indices, associations } = fixture;
  const collected = collectClusterPages(source, metadata, indices, associations);
  const gpu = mockGpu({ packed: packDagSelection(collected.roots) });
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  }) as WebgpuPagesBackend;
  await backend.prepare();
  const cam = camera();
  backend.render(cam);
  await backend.flush();
  cam.lookAt(100, 0, 5);
  cam.updateMatrixWorld();
  gpu.commands.length = 0;
  backend.render(cam);
  // The cut, then the copy of its readback — the view moved —, then the partition's pass.
  assert.deepEqual(gpu.commands.slice(0, gpu.commands.indexOf(`compute ${PARTITION_PASS}`)), [
    'compute Trillion3D DAG selection',
    'copy',
  ]);
  // A view that moves again rewrites what carries the view, not the words it left alone: the
  // compaction's counts, the occlusion test's size and rows, the material cache's header.
  cam.lookAt(90, 0, 5);
  cam.updateMatrixWorld();
  const before = gpu.writes.length;
  backend.render(cam);
  const written = new Set(gpu.writes.slice(before).map((write) => write.label));
  for (const unchanged of [
    'Trillion3D draw compaction uniform',
    'Trillion3D HiZ uniforms',
    'Trillion3D material cache',
  ])
    assert.equal(written.has(unchanged), false, unchanged);
  assert.equal(written.has('Trillion3D partition uniform v1'), true, 'the view did move');
  await backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
