import * as G from '../../scene/host/graph/graph.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { quadScene, camera } from './testScenes.fixture.ts'
import { createWebgpuPagesRuntime } from './runtime.ts'
import { prepareWebgpuBackend } from '../prepare/prepare.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { flushWebgpuPages } from '../render/flush.ts'
import type { EngineContext } from '../../session/engine/types.ts'
import type { EngineDiagnostic } from '../../diagnostic/types.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

/** The red quad on a prepared runtime, its main view drawn twice from the front; `options` add
 *  to its context; `fixture` is the scene when a test has set something on it first. */
export async function drawnQuad(options: Partial<EngineContext> = {}, fixture = quadScene()) {
  installGpuGlobals()
  const gpu = fakeDevice(BACKEND)
  const events: EngineDiagnostic[] = []
  const rt = createWebgpuPagesRuntime({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
    ...options,
  })
  await prepareWebgpuBackend(rt, gpu.device)
  for (let i = 0; i < 2; i++) {
    renderWebgpuPages(rt, camera())
    await flushWebgpuPages(rt)
  }
  return { rt, gpu, events }
}

/** A camera beside the quad, looking away from it. */
export function awayCamera() {
  const away = G.perspectiveCamera(55, 1, 0.1, 100)
  away.position.set(0, 0, 3)
  away.lookAt(0, 0, 6)
  away.updateMatrixWorld()
  return away
}
