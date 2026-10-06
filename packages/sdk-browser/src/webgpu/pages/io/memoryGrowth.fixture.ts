// The session the table growth tests of #216 open: the deep quad on a pool at its floor.
import { createSceneLightStore, type SceneLight } from '../../../../../sdk-core/src/index.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { frontCamera } from '../../../backend/pagesBackendScenes.fixture.ts'
import { deepQuadScene } from '../deepQuad.fixture.ts'
import { createWebgpuPagesRuntime } from '../runtime.ts'
import { prepareWebgpuBackend } from '../prepare/prepare.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { flushWebgpuPages } from '../render/flush.ts'
import { fallbackToCpuCut } from './drops.ts'
import { disposeWebgpuPages } from './metrics.ts'
import { SHADOW_LIMITS } from '../testScenes.fixture.ts'

/** A sun that casts: the session's shadow cull, spheres and mobility words then exist. */
export const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, 0, -1],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
}

/** The deep quad (`../deepQuad.fixture.ts`), on a pool at its floor — the root and the coarse page
 *  its group replaces, no slot for the leaves — and tables sized for it, the CPU cut drawing at
 *  full detail, lit by `light` when given. The device answers out-of-memory scopes, and refuses
 *  the page table while `refusing.on`. */
export async function coarseSession(light?: SceneLight) {
  installGpuGlobals()
  const scene = deepQuadScene()
  const gpu = mockGpu({ compute: true, limits: SHADOW_LIMITS }),
    { device } = gpu
  const sceneLights = createSceneLightStore()
  if (light) sceneLights.add(light)
  const refusing = { on: false },
    scopes: Array<{ message: string } | null> = []
  const create = device.createBuffer.bind(device)
  Object.assign(device, {
    pushErrorScope: () => void scopes.push(null),
    popErrorScope: async () => scopes.pop() ?? null,
    createBuffer(descriptor: GPUBufferDescriptor) {
      if (refusing.on && descriptor.label === 'Trillion3D page table' && scopes.length)
        scopes[scopes.length - 1] = { message: 'Out of memory' }
      return create(descriptor)
    },
  })
  const rt = createWebgpuPagesRuntime({
    ...scene,
    pixelError: 0,
    gpuDevice: device,
    geometryPoolBytes: 1,
    viewport: [32, 32],
    sceneLights,
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
    fallbackToCpuCut(rt, 'the rows follow the CPU cut')
    await draw(3)
  } catch (error) {
    dispose()
    throw error
  }
  const drawn = () =>
    rt.layout.rows.packedRecs.slice(0, rt.layout.rows.packedCount).map((rec) => rec!.url)
  return { rt, gpu, refusing, draw, drawn, dispose }
}
