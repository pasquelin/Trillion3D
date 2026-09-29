import * as G from '../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from './testScenes.fixture.ts';
import { createWebgpuPagesRuntime } from './runtime.ts';
import { prepareWebgpuBackend } from './prepare/prepare.ts';
import { renderWebgpuPages } from './render/render.ts';
import { flushWebgpuPages } from './render/flush.ts';
import type { BackendContext, BackendDiagnostic } from '../../backend/types.ts';

/** The red quad on a prepared runtime, its main view drawn twice from the front; `options` add
 *  to its context. */
export async function drawnQuad(compute: boolean, options: Partial<BackendContext> = {}) {
  installGpuGlobals();
  const gpu = mockGpu({ compute });
  const fixture = quadScene(),
    events: BackendDiagnostic[] = [];
  const rt = createWebgpuPagesRuntime({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
    ...options,
  });
  await prepareWebgpuBackend(rt, gpu.device);
  for (let i = 0; i < 2; i++) {
    renderWebgpuPages(rt, camera());
    await flushWebgpuPages(rt);
  }
  return { rt, gpu, events };
}

/** A camera beside the quad, looking away from it. */
export function awayCamera() {
  const away = G.perspectiveCamera(55, 1, 0.1, 100);
  away.position.set(0, 0, 3);
  away.lookAt(0, 0, 6);
  away.updateMatrixWorld();
  return away;
}
