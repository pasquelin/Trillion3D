// The session the pool growth tests open: the deep quad on a pool at its floor.
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { frontCamera } from '../../session/engine/pagesEngineScenes.fixture.ts'
import { deepQuadScene } from '../backend/deepQuad.fixture.ts'
import { createWebgpuPagesRuntime } from '../backend/runtime.ts'
import { prepareWebgpuBackend } from '../prepare/prepare.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { flushWebgpuPages } from '../render/flush.ts'
import { disposeWebgpuPages } from './metrics.ts'
import { SHADOW_LIMITS } from '../backend/testScenes.fixture.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

/** The deep quad (`../backend/deepQuad.fixture.ts`), on a pool at its floor — the root's grain
 *  alone, no streaming slot for the coarse page nor the leaves —, the GPU cut drawing at full detail.
 *  The device answers out-of-memory scopes, and refuses the pool's probe while `refusing.on`. */
export async function coarseSession() {
  installGpuGlobals()
  const scene = deepQuadScene()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS }),
    { device } = gpu
  const refusing = { on: false },
    scopes: Array<{ message: string } | null> = []
  const create = device.createBuffer.bind(device)
  Object.assign(device, {
    pushErrorScope: () => void scopes.push(null),
    popErrorScope: async () => scopes.pop() ?? null,
    createBuffer(descriptor: GPUBufferDescriptor) {
      if (refusing.on && descriptor.label === 'Trillion3D pool probe' && scopes.length)
        scopes[scopes.length - 1] = { message: 'Out of memory' }
      return create(descriptor)
    },
  })
  const rt = createWebgpuPagesRuntime({
    textureCaches: createTextureCaches(createPageCache()),
    ...scene,
    pixelError: 0,
    gpuDevice: device,
    geometryPoolBytes: 1,
    viewport: [32, 32],
  })
  const draw = async (images = 1) => {
    for (let image = 0; image < images; image++) {
      renderWebgpuPages(rt, frontCamera())
      await flushWebgpuPages(rt)
    }
  }
  const dispose = () => {
    disposeWebgpuPages(rt)
    scene.geometry.dispose()
    scene.material.dispose()
  }
  try {
    await prepareWebgpuBackend(rt, device)
    await draw(3)
  } catch (error) {
    dispose()
    throw error
  }
  // What the image draws: the drawn list of its adopted readback.
  const drawn = () => rt.run.shown.map((rec) => rec.url)
  return { rt, gpu, refusing, draw, drawn, dispose }
}
