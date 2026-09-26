// A frame that first casts a shadow is held until the device grants the shadow pool (#542). A
// drain after it (`flush`, and so `awaitPages`) waits for that answer and draws the pose: without
// it, a scene whose pages were all resident at prepare left `awaitPages` with no frame drawn and
// no cut adopted, and the next frame, captured alone, was blank (test:gpu `default-backend`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from '../pages.ts';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { createSceneLightStore } from '../../../../../sdk-core/src/index.ts';
import { SUN } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, quadScene } from '../testScenes.fixture.ts';
import type { WebgpuPagesBackend } from '../runtime.ts';

test('a drain waits for the shadow pool the device still answers for, then draws and adopts the cut', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const packed = packDagSelection(
    collectClusterPages(source, metadata, indices, associations).roots,
  );
  const gpu = mockGpu({ packed });
  // A real device answers an error scope after a round trip, never within the same task.
  const pop = gpu.device.popErrorScope.bind(gpu.device);
  Object.assign(gpu.device, {
    popErrorScope: async () => (await new Promise((resolve) => setTimeout(resolve, 5)), pop()),
  });
  const sceneLights = createSceneLightStore();
  sceneLights.add(SUN);
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: gpu.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelError: 0,
    sceneLights,
  }) as WebgpuPagesBackend;
  await backend.prepare();
  const cam = camera();
  backend.render(cam);
  assert.deepEqual(backend.selectedPageIds(), [], 'the first frame is held on the pool: no cut');
  await backend.flush();
  assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1'], 'the drain drew and adopted');
  backend.render(cam);
  const metrics = backend.metrics();
  assert.equal(metrics.selectedTriangles, 2);
  assert.notEqual(metrics.clusters, null);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
