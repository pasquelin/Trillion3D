// The local fog volumes' frame tests' common ground (`localFogView.test.ts`, `localFogPrepare.test.ts`): a
// runtime over the kit's device, its light buffer and a store of local fog volumes, and the image it draws
// from an eye — which prepares the volumes and encodes the lists.
import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { createSceneLocalFogStore } from '../../../../sdk-core/src/scene/localFog/store.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createFogStandIns } from '../../lighting/fog/read.ts'
import { camera } from '../../lighting/fogVolumeRun.fixture.ts'
import { viewProj } from '../backend/helpers.ts'
import { LIGHT_BUFFER_AT } from '../backend/state/lightBufferLayout.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { encodeLocalFog, prepareLocalFog } from './encodeLocalFog.ts'

/** A store holding a sun of colour `[1, 0.5, 0.25]`, intensity 4, going down and a little toward +x. */
export function sunStore() {
  const store = createSceneLightStore()
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0.6, -0.8, 0],
    color: [1, 0.5, 0.25],
    intensity: 4,
    castsShadow: false,
  })
  return store
}

/** The matrix of a volume at `(x, y, z)`. */
export const at = (x: number, y: number, z: number) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
]
/** Lets the passes asked off the frame settle. */
export const later = () => new Promise((resolve) => setTimeout(resolve, 20))

/** The kit's light buffer, as the frame makes it. */
export const lightBufferOf = (device: GPUDevice) =>
  device.createBuffer({
    label: 'lights',
    size: LIGHT_BUFFER_AT.items + 4096,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** A runtime over `lights`, a store of local fog volumes, the kit's device (with `limits` and `options`) and
 *  its light buffer, and `image`: one image from the eye at `eye`, which prepares the volumes and encodes
 *  the lists. */
export function harness(
  lights: ReturnType<typeof createSceneLightStore>,
  limits?: Record<string, number>,
  options?: { failCompute?: boolean },
) {
  const gpu = fakeDevice({ limits: { maxBufferSize: 1 << 26, ...limits }, ...options })
  const { device } = gpu
  const volumes = createSceneLocalFogStore()
  const buffer = lightBufferOf(device)
  const said: string[] = []
  const stand = createFogStandIns(device)
  const rt = {
    context: { sceneLocalFog: volumes },
    lights: { store: lights, buffer },
    gpu: {
      targetSize: [160, 90],
      deferred: { placeholders: { fog: stand.read } },
    },
    setup: { localFog: true },
    run: { diagnostic: 'beauty', depthDrawn: false, frame: 1 },
    vis: {},
    diag: { diagnosticFailure: (phase: string) => said.push(phase) },
  } as unknown as WebgpuPagesRuntime
  /** The words written into the light buffer since the last image, by their offset. */
  const written = () =>
    gpu.writes
      .filter((w) => w.buffer === buffer)
      .map((w) => ({ offset: w.offset, floats: Array.from(w.data as ArrayLike<number>) }))
  const image = (eye: [number, number, number]) => {
    gpu.writes.length = 0
    gpu.dispatches.length = 0
    const cam = camera(eye)
    viewProj.set(cam.viewProj)
    const encoder = device.createCommandEncoder()
    const view = { ...cam, viewProjection: cam.viewProj } as never
    prepareLocalFog(rt, device, view)
    const steps = new ComputeRun().begin(encoder)
    encodeLocalFog(rt, device, steps)
    steps.end()
    return encoder
  }
  /** A slot of the block, as the light buffer holds it now. */
  const header = (slot: number) => {
    const { data } = rt.lights.buffer as unknown as { data: Uint8Array }
    const at = data.byteOffset + LIGHT_BUFFER_AT.localFog + slot * 16
    return Array.from(new Float32Array(data.buffer, at, 4))
  }
  return { gpu, rt, volumes, buffer, said, stand, written, image, header }
}
