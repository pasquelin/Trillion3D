// A frame that first casts a shadow is held until the device grants the shadow pool (#542). A
// drain after it (`flush`, and so `awaitPages`) waits for that answer and draws the pose: without
// it, a scene whose pages were all resident at prepare left `awaitPages` with no frame drawn and
// no cut adopted, and the next frame, captured alone, was blank (test:gpu `default-backend`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { createSceneLightStore } from '../../../../../sdk-core/src/index.ts';
import { SUN } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, disposeQuadRun, quadBackend, quadScene } from '../testScenes.fixture.ts';
import type { WebgpuPagesBackend } from '../runtime.ts';

test('a drain waits for the shadow pool the device still answers for, then draws and adopts the cut', async () => {
  installGpuGlobals();
  const scene = quadScene();
  const { roots } = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const gpu = mockGpu({ packed: packDagSelection(roots) });
  scene.geometry.dispose();
  scene.material.dispose();
  // A real device answers an error scope after a round trip, never within the same task.
  const pop = gpu.device.popErrorScope.bind(gpu.device);
  Object.assign(gpu.device, { popErrorScope: async () => (await setTimeout(5), pop()) });
  const sceneLights = createSceneLightStore();
  sceneLights.add(SUN);
  const { fixture, backend } = quadBackend(gpu.device, {
    maxResidentPages: 4,
    pixelError: 0,
    sceneLights,
  });
  await backend.prepare();
  const pages = () => (backend as WebgpuPagesBackend).selectedPageIds().sort();
  backend.render(camera());
  assert.deepEqual(pages(), [], 'the first frame is held on the pool: no cut');
  assert.ok(backend.flush, 'the WebGPU pages backend drains');
  await backend.flush();
  assert.deepEqual(pages(), ['0', '1'], 'the drain drew and adopted');
  disposeQuadRun(backend, fixture);
});
