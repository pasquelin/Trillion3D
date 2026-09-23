import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clusterErrorPixels, maxStretch } from '../../../../sdk-core/src/index.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import {
  createGpuDagSelection,
  evaluateDagSelectionKernel,
  packDagSelection,
  DAG_SELECTION_SHADER,
} from './selection.ts';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { dagCulling } from '../../page/selection/helpers.fixture.ts';
import {
  cpuUrls,
  kernelUniforms,
  kernelUrls,
  packed,
  VIEWPORT,
} from './selectionHelpers.fixture.ts';
import { mockDagDevice } from './selection.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

test('the kernel projects a cluster error exactly like clusterErrorPixels', () => {
  // The WGSL band test is the certified bound of `screenErrorBound`: minimum depth, side reach and
  // the moved point's closest depth, with Infinity at the near plane. Replaying it against the
  // published oracle keeps the GPU and CPU cuts on one formula.
  const cam = wideCamera();
  const uniforms = cameraSelectionUniforms(cameraMoteur(cam), 1, VIEWPORT);
  const focal = Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]);
  const world = new THREE.Matrix4().makeRotationY(0.7).setPosition(1, -2, 3);
  const view = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, world),
    e = view.elements;
  const stretch = maxStretch(world.elements) * (uniforms.cameraStretch as number);
  assert.ok(Number.isFinite(stretch) && stretch > 0);
  for (const [cx, cy, cz, radius, error] of [
    [0, 0, 0, 0.6, 0.02],
    [3, -1, 2, 1.2, 0.5],
    [-4, 2, -6, 0.1, 7],
    [0, 0, 4.9, 0.05, 1],
    [0, 0, 0, 0.6, 0],
  ] as const) {
    const vx = e[0] * cx + e[4] * cy + e[8] * cz + e[12],
      vy = e[1] * cx + e[5] * cy + e[9] * cz + e[13],
      vz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
    const expected = clusterErrorPixels(error, stretch, vx, vy, vz, radius, focal, cam.near);
    // `projected` from `shader/shaderError.ts`, copied: same operands, same order.
    const reach = radius * stretch,
      shift = error * stretch;
    const nearest = -vz - reach,
      closest = nearest - shift,
      side = Math.sqrt(vx * vx + vy * vy) + reach;
    const slant = Math.sqrt(nearest * nearest + side * side);
    const kernel =
      error === 0
        ? 0
        : !(closest > cam.near) || !(slant >= nearest && slant < Infinity)
          ? Infinity
          : ((shift * focal) / nearest) * (slant / closest);
    assert.equal(kernel, expected, `error ${error} radius ${radius}`);
  }
  // The shader carries the same terms, in the same order.
  assert.match(
    DAG_SELECTION_SHADER,
    /let nearest=p\*\(-v\.z-reach\)\+flat;let closest=nearest-p\*shift;let side=p\*\(sqrt\(v\.x\*v\.x\+v\.y\*v\.y\)\+reach\);/,
  );
  assert.match(DAG_SELECTION_SHADER, /return \(\(shift\*focal\)\/nearest\)\*\(slant\/closest\);/);
});

test('the GPU flat cut selects the same single cluster per chain as the CPU cut', () => {
  const plain = dagFixture(),
    accelerated = dagFixture();
  accelerated.metadata.primitives[0].culling = dagCulling();
  const cam = wideCamera();
  const chains = [
    ['leaf0', 'mid-left', 'root'],
    ['leaf1', 'mid-left', 'root'],
    ['leaf2', 'mid-right', 'root'],
    ['leaf3', 'mid-right', 'root'],
  ];
  for (const pixelError of [0, 1, 3.4, 3.6, 20, 60, 200, 1e6]) {
    const cpu = cpuUrls(plain, pixelError, cam);
    assert.deepEqual(kernelUrls(plain, pixelError, cam).urls, cpu, `pixelError ${pixelError}`);
    // The culling hierarchy is only an early reject: it must not change the selected set.
    assert.deepEqual(
      kernelUrls(accelerated, pixelError, cam).urls,
      cpu,
      `accelerated pixelError ${pixelError}`,
    );
    const shown = new Set(cpu);
    for (const chain of chains)
      assert.equal(
        chain.filter((url) => shown.has(url)).length,
        1,
        `pixelError ${pixelError}: ${chain.join('>')}`,
      );
  }
  plain.geometry.dispose();
  accelerated.geometry.dispose();
});

test('a cut with nothing resident but the roots publishes the root cover', () => {
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const resident = Uint32Array.from(dag.pageUrls.map((url) => (url === 'root' ? 1 : 0)));
  const result = evaluateDagSelectionKernel(
    dag,
    kernelUniforms(dag, roots, wideCamera(), 0),
    resident,
  );
  assert.deepEqual(
    (result.drawablePageIds ?? []).map((id) => dag.pageUrls[id]),
    ['root'],
  );
  assert.equal(result.complete, true, 'the pinned root cover must leave no hole');
  // The wanted list still reports the detail the streamer has to fetch.
  assert.deepEqual((result.pageIds ?? []).map((id) => dag.pageUrls[id]).sort(), [
    'leaf0',
    'leaf1',
    'leaf2',
    'leaf3',
  ]);
  fixture.geometry.dispose();
});

test('a missing cluster is replaced by its nearest resident ancestor, not by the root', () => {
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  // Every cluster is resident except one leaf: its group replacement covers the gap on its own.
  const resident = Uint32Array.from(dag.pageUrls.map((url) => (url === 'leaf0' ? 0 : 1)));
  const result = evaluateDagSelectionKernel(
    dag,
    kernelUniforms(dag, roots, wideCamera(), 0),
    resident,
  );
  const drawn = (result.drawablePageIds ?? []).map((id) => dag.pageUrls[id]).sort();
  assert.deepEqual(drawn, ['mid-left', 'mid-right']);
  assert.equal(result.complete, true);
  assert.ok(!drawn.includes('root'), 'the pinned cover is the last resort, not the first');
  fixture.geometry.dispose();
});

test('a device without compute pipelines keeps the CPU cut by not creating GPU selection', async () => {
  const fixture = dagFixture();
  const { dag } = packed(fixture);
  const device = {
    limits: { maxBufferSize: 1 << 20 },
    createBuffer() {
      throw new Error('should not allocate');
    },
  } as unknown as GPUDevice;
  assert.equal(await createGpuDagSelection(device, dag), undefined);
  fixture.geometry.dispose();
});

test('an empty cluster set does not allocate a GPU selection', async () => {
  installGpuGlobals();
  const dag = packDagSelection([]);
  assert.equal(dag.pageCount, 0);
  assert.equal(await createGpuDagSelection(mockDagDevice(dag).device, dag), undefined);
});

test('GPU selection readback page ids match the CPU oracle for the same camera', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const cam = wideCamera();
  // The render frame is set BEFORE creation: the GPU receives matrices already brought back to
  // the eye, as the engine carries them each frame.
  const uniforms = kernelUniforms(dag, roots, cam, 3.4);
  const selection = await createGpuDagSelection(mockDagDevice(dag).device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  const gpu = await selection.flush();
  assert.ok(gpu);
  assert.deepEqual(gpu.pageIds.map((id) => dag.pageUrls[id]).sort(), cpuUrls(fixture, 3.4, cam));
  assert.equal(selection.peek()?.uniforms.pixelError, 3.4);
  selection.dispose();
  fixture.geometry.dispose();
});
