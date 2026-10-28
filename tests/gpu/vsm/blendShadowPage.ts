// Page of the blended receiver's shadow proof (`blend-shadow.gpu.ts`): the real WebGPU engine on
// the generated penumbra scene (`penumbraScene.ts`), lit by its wide sun, read back held — the
// receiver opaque, the same receiver blended, and the opaque one with the slats taken away.
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts'
import { engine, release } from '../../kit/device/sharedSceneProof.ts'
import { untilHeld } from '../../kit/device/sceneImageProof.ts'
import { runOnDevice } from '../../kit/device/deviceProof.ts'
import { pixelLuminance } from './shadowScene.ts'
import { WIDE_SUN, penumbraCamera, penumbraScene, type Receiver } from './penumbraScene.ts'

type Shot = { held: boolean; pixels: number[] }

/** How the blended image differs from the opaque one, for the diagnostic line: the pixels more than
 *  two steps apart, the worst step and where it lies with both colours, and the blocks of 8 x 8
 *  pixels whose means differ by more than two steps, with the worst block. */
export type Difference = {
  apart: number
  worst: number
  worstAt: { x: number; y: number; opaque: number[]; blend: number[] }
  blocks: number
  worstBlock: number
}

export type Shots = Record<'opaque' | 'blend' | 'open', Shot> & {
  blocks?: Difference
}

const BLOCK = 8

function difference(a: Uint8Array, b: Uint8Array): Difference {
  const side = Math.round(Math.sqrt(a.length / 4)),
    across = Math.floor(side / BLOCK)
  const sums = new Float64Array(across * across)
  let apart = 0,
    worst = 0,
    at = 0
  for (let i = 0; i < side * side; i++) {
    const d = Math.abs(pixelLuminance(a, i) - pixelLuminance(b, i))
    if (d > 2) apart++
    if (d > worst) [worst, at] = [d, i]
    const [x, y] = [i % side, Math.floor(i / side)]
    if (x < across * BLOCK && y < across * BLOCK)
      sums[Math.floor(y / BLOCK) * across + Math.floor(x / BLOCK)] +=
        pixelLuminance(a, i) - pixelLuminance(b, i)
  }
  const means = Array.from(sums, (sum) => Math.abs(sum) / (BLOCK * BLOCK))
  return {
    apart,
    worst,
    worstAt: {
      x: at % side,
      y: Math.floor(at / side),
      opaque: Array.from(a.subarray(4 * at, 4 * at + 4)),
      blend: Array.from(b.subarray(4 * at, 4 * at + 4)),
    },
    blocks: means.filter((m) => m > 2).length,
    worstBlock: Math.max(...means),
  }
}

async function shot(device: GPUDevice, events: unknown[], receiver: Receiver, open: boolean) {
  const prepared = penumbraScene(receiver, { open })
  const sceneLights = createSceneLightStore()
  sceneLights.add(WIDE_SUN)
  // The blended receiver is traced as the opaque one (the project switch `shadowTranslucentQuality`).
  const { backend, canvas } = engine(prepared, device, (e) => events.push(e), {
    sceneLights,
    pixelError: 1,
    shadowTranslucentQuality: 1,
    // The scene has no sky: the blended receiver takes no bounce the opaque one lacks.
    translucencyGi: false,
    // The three images are compared at one exposure: an automatic one brightens the shaded image.
    exposureMethod: 'manual',
    exposureApplyPhysicalCamera: false,
  })
  try {
    await backend.prepare()
    const { settled: held, rendered } = await untilHeld(backend, penumbraCamera())
    return { held: held !== null, pixels: held ?? rendered ?? [] }
  } finally {
    release(backend, canvas, prepared)
  }
}

export const run = () =>
  runOnDevice<Shots>(async (device, events, result) => {
    const opaque = (result.opaque = await shot(device, events, 'opaque', false))
    const blend = (result.blend = await shot(device, events, 'blend', false))
    result.open = await shot(device, events, 'opaque', true)
    const bytes = (taken: Shot) => Uint8Array.from(taken.pixels)
    result.blocks = difference(bytes(opaque), bytes(blend))
  })
