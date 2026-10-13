// Page of the blended receiver's shadow proof (`blend-shadow.gpu.ts`): the real WebGPU engine on
// the generated penumbra scene (`penumbraScene.ts`), lit by its wide sun, read back held — the
// receiver opaque, the same receiver blended, and the opaque one with the slats taken away.
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { engine, release } from '../kit/sharedSceneProof.ts'
import { untilHeld } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { WIDE_SUN, penumbraCamera, penumbraScene, type Receiver } from './penumbraScene.ts'

export type Shots = Record<'opaque' | 'blend' | 'open', { held: boolean; pixels: number[] }>

async function shot(device: GPUDevice, events: unknown[], receiver: Receiver, open: boolean) {
  const prepared = penumbraScene(receiver, { open })
  const sceneLights = createSceneLightStore()
  sceneLights.add(WIDE_SUN)
  const { backend, canvas } = engine(prepared, device, (e) => events.push(e), {
    sceneLights,
    pixelError: 1,
  })
  try {
    await backend.prepare()
    const { held, rendered } = await untilHeld(backend, penumbraCamera())
    return { held: held !== null, pixels: held ?? rendered ?? [] }
  } finally {
    release(backend, canvas, prepared)
  }
}

export const run = () =>
  runOnDevice<Shots>(async (device, events, result) => {
    result.opaque = await shot(device, events, 'opaque', false)
    result.blend = await shot(device, events, 'blend', false)
    result.open = await shot(device, events, 'opaque', true)
  })
