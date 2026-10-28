// The stochastic direct light's programs assemble, and their sample is packed as the reference packs it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import {
  STOCHASTIC_COMPACT_ENTRY,
  STOCHASTIC_GENERATE_ENTRY,
  STOCHASTIC_GENERATE_WGSL,
  STOCHASTIC_SHADE_ENTRY,
  STOCHASTIC_TEMPORAL_ENTRY,
  stochasticTemporalProgramOf,
  stochasticCompactProgramOf,
  stochasticShadeProgramOf,
} from './stochasticWgsl.ts'
const STOCHASTIC_TEMPORAL_WGSL = stochasticTemporalProgramOf(WORD_LIGHT_FORMAT)

test('the four programs assemble, over masks in both formats', () => {
  assertProgramAssembles(STOCHASTIC_GENERATE_WGSL, STOCHASTIC_GENERATE_ENTRY)
  assertProgramAssembles(STOCHASTIC_TEMPORAL_WGSL, STOCHASTIC_TEMPORAL_ENTRY)
  for (const format of ['grey', 'colour'] as const) {
    assertProgramAssembles(stochasticCompactProgramOf(format), STOCHASTIC_COMPACT_ENTRY)
    assertProgramAssembles(
      stochasticShadeProgramOf(format, WORD_LIGHT_FORMAT),
      STOCHASTIC_SHADE_ENTRY,
    )
  }
})

test('a sample packs its light in 12 bits, its flags at 0x8000 and 0x4000 and its weight as a half float over them', () => {
  const text = STOCHASTIC_GENERATE_WGSL
  assert.ok(text.includes('0xfffu'))
  assert.ok(text.includes('select(0u,0x8000u,visible)|select(0u,0x4000u,completed)'))
  assert.ok(text.includes('pack2x16float(vec2f(weight,0.0))&0xffffu)<<16u'))
})

test('the generation picks as the reservoir does: tau is the running share, the number is rescaled in the half it falls in, and a weight is the sum over the samples times its own', () => {
  const text = STOCHASTIC_GENERATE_WGSL
  assert.ok(text.includes('let tau=weightSum/(weightSum+picked.weight);'))
  assert.ok(text.includes('random[s]/=tau;'))
  assert.ok(text.includes('random[s]=(random[s]-tau)/(1.0-tau);'))
  assert.ok(text.includes('weightSum/(f32(samples)*weight[s])'))
  assert.ok(text.includes('log2(luminanceOf(pdf)+1.0)'))
})
