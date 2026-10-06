// The screen mirror proof's renderer: the real WebGPU engine on a mirror scene, a dim sun, bounce
// optional, and the held image it reads — rendered until held, then once more to prove it stable.
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts'
import type { BackendContext } from '../../../packages/sdk-browser/src/backend/types.ts'
import { release as releaseScene } from '../kit/sharedSceneProof.ts'
import { image, PLAFOND, difference } from '../kit/sceneImageProof.ts'
import { mirrorProxy } from './mirrorProxy.ts'
import type { mirrorScene } from './screenMirrorScene.ts'

export const MIRROR_SIZE = 192

export async function mirrorRenderer(
  rig: ReturnType<typeof mirrorScene>,
  device: GPUDevice,
  events: unknown[],
  bounce = false,
) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = MIRROR_SIZE
  document.body.append(canvas)
  const lights = createSceneLightStore()
  lights.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, 0, -1],
    color: [1, 1, 1],
    intensity: 0.1,
    castsShadow: false,
  })
  const { scene, camera } = rig
  let bounceReady = false
  const context: BackendContext = {
    source: scene.source,
    metadata: scene.metadata,
    indices: scene.indices,
    associations: scene.associations,
    viewport: [MIRROR_SIZE, MIRROR_SIZE],
    clearColor: 0,
    temporalAntialiasing: false,
    bounce,
    // Black proxy outside all reflected source rays: activate probes without adding radiance.
    readSceneProxy: bounce ? async () => mirrorProxy(10, 0xff000000) : undefined,
    sceneLights: lights,
    onDiagnostic: (event) => {
      events.push(event)
      if (event.phase === 'bounce-lighting')
        bounceReady = Number(event.context.proxyTriangles) > 0 && event.context.unavailable === null
    },
  }
  const backend = webgpuPagesBackend({ ...context, gpuDevice: device, gpuCanvas: canvas })
  await backend.prepare()
  const frame = async () => {
    const result = await image(backend, camera)
    return { pixels: result.pixels.slice(), held: result.metrics.frameHeld === true }
  }
  return {
    backend,
    resize(size: number) {
      context.viewport![0] = context.viewport![1] = size
    },
    async held() {
      for (let i = 0; i < PLAFOND; i++) {
        const result = await frame()
        // Active probes intentionally keep the backend awake. Zero diffuse energy in this
        // scene makes consecutive completed images deterministic without waiting for hold.
        if (bounce && bounceReady) {
          const completed = await frame()
          const repeated = await frame()
          return {
            pixels: completed.pixels,
            stable: difference(completed.pixels, repeated.pixels),
          }
        }
        if (!bounce && result.held) {
          const repeated = await frame()
          if (!repeated.held) throw new Error('Static mirror frame unexpectedly woke')
          return { pixels: result.pixels, stable: difference(result.pixels, repeated.pixels) }
        }
      }
      throw new Error(`mirror ${bounce ? 'bounce never became available' : 'frame never held'}`)
    },
    dispose() {
      releaseScene(backend, canvas, scene)
    },
  }
}
