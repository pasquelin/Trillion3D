import { fromF32Bits } from '../../../../math/src/float/bits.ts'
import { NO_CONTACT_SHADOW_VIEW } from './contactShadowView.ts'
import type { LightLanes } from './fields.ts'
import { NO_LIGHT_SHADOW_VIEW } from './shadowedBits.ts'

/** The lanes of lights written alone into `packed` (`writeLightFields`): its words the same buffer's, the views of no store. */
export const lanesOf = (packed: Float32Array): LightLanes => ({
  packed,
  words: new Uint32Array(packed.buffer, packed.byteOffset, packed.length),
  contactView: NO_CONTACT_SHADOW_VIEW,
  shadowView: NO_LIGHT_SHADOW_VIEW,
})

/** A kind word (`LIGHT_FIELD.kind`) as the float a hand-made light record holds it in: its bits, which the shaders read with `bitcast<u32>`. */
export const kindLane = (word: number) => fromF32Bits(word)
