// A settled WebGPU runtime drawing an effect chain into the kit's encoder, for the effect chain's
// tests (`encodeEffects.test.ts`, `encodeEffectsOutput.test.ts`).
import type { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { settledRt } from '../loop/hold.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { AccumulatedImage } from '../../lighting/deferred/program.ts'
import { families } from '../../session/host/families.ts'
import { exposureSettings } from '../../post/exposure/frame.ts'
import { beginFinishScene, encodeFinish } from '../../post/finish/frame.ts'

// The effects' code, which a frame that draws them waits for (`familyUse.ts`), arrived.
await families.effects.load()

export const input = { color: {} } as AccumulatedImage
/** The kit's encoder the chains draw into, and the passes they begin there. */
const { device: encoding, passes, computePasses } = fakeDevice()
export { passes, computePasses }
export const encoder = encoding.createCommandEncoder()

/** The view uniform the finishing copies the exposure from. */
const view = encoding.createBuffer({
  size: 1024,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
})

/** A settled runtime drawing `chain`, in the beauty view, with no pass drawn yet; its lit program
 *  in place and settled (`usesContract`, `settle`), its composition compiled with the finishing
 *  (`composesFinish`). */
export function drawing(chain: EffectChain) {
  const rt = settledRt()
  rt.context.effects = chain
  Object.assign(rt.run, { diagnostic: 'beauty' })
  // Targets allocated at the size drawn: a frame that draws again keeps it, and its occluders.
  Object.assign(rt.gpu, { targetSize: [8, 4], displaySize: [8, 4], allocatedSize: [8, 4] })
  Object.assign(rt.gpu, {
    deferred: {
      usesContract: true,
      settle: async () => {},
      composesFinish: () => true,
      uniform: view,
    },
  })
  return rt
}

/** What the finishing shares with the chain for the image `color` of `size` pixels, begun in the
 *  kit's encoder as the renderer begins it; none where it leaves the image as it is. */
export const framed = (
  rt: ReturnType<typeof drawing>,
  device: GPUDevice,
  color: GPUTextureView = input.color,
  size: readonly number[] = [8, 4],
) =>
  encodeFinish(
    rt,
    device,
    encoder,
    beginFinishScene(rt, device, encoder, color, size, false),
    exposureSettings(rt),
  )
