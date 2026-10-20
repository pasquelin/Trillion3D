// A settled WebGPU runtime drawing an effect chain into the kit's encoder, for the effect chain's
// tests (`encodeEffects.test.ts`, `encodeEffectsOutput.test.ts`).
import type { EffectChain } from '../../../../../sdk-core/src/world/effect/chain.ts'
import { settledRt } from '../../frame/hold.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { AccumulatedImage } from '../../../lighting/deferred/program.ts'
import { families } from '../../../host/families.ts'

// The effects' code, which a frame that draws them waits for (`familyUse.ts`), arrived.
await families.effects.load()

export const input = { color: {}, share: {} } as AccumulatedImage
/** The kit's encoder the chains draw into, and the passes they begin there. */
const { device: encoding, passes } = fakeDevice()
export { passes }
export const encoder = encoding.createCommandEncoder()

/** A settled runtime drawing `chain`, in the beauty view, with no pass drawn yet; its lit program
 *  in place and settled (`usesContract`, `settle`), its composition compiled with the blend of a
 *  last bloom (`composesBloom`). */
export function drawing(chain: EffectChain) {
  const rt = settledRt()
  rt.context.effects = chain
  Object.assign(rt.run, { diagnostic: 'beauty' })
  // Targets allocated at the size drawn: a frame that draws again keeps it, and its occluders.
  Object.assign(rt.gpu, { targetSize: [8, 4], displaySize: [8, 4], allocatedSize: [8, 4] })
  Object.assign(rt.gpu, {
    deferred: { usesContract: true, settle: async () => {}, composesBloom: () => true },
  })
  return rt
}
