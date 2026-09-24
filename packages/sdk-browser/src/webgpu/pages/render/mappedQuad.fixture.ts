import * as G from '../../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, quadScene } from '../testScenes.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';

/** A pages backend on the mock device drawing the quad scene with `map` on its surface: prepared,
 *  one image drawn and flushed — the state a change made after it is measured from. */
export async function mappedQuadRun(map: G.GraphTexture) {
  installGpuGlobals();
  const gpu = mockGpu();
  map.needsUpdate = true;
  const fixture = quadScene();
  const surface = fixture.material as G.GraphSurface;
  surface.map = map;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await backend.prepare();
  const cam = camera();
  backend.render(cam);
  await backend.flush?.();
  return { gpu, fixture, surface, backend, cam };
}
