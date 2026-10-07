// The transparent programs' text, character for character, over every variant: the blend vertex
// stage lobed and lobeless, the blend module and the water composite under every contract key (and
// the composite bounded and unbounded). The templates were split into named parts (`vertexWgsl.ts`,
// `shader.ts`, `../water/waterColorWgsl.ts`); the digests were taken on the split, whose text was
// checked byte for byte against the single templates'. A deliberate change to any WGSL these
// programs include takes new digests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { blendShader } from './shader.ts'
import { waterCompositeShader } from '../water/compositeWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'

const VERTEX = '629ec43f6a4704011026651d0d1e9fc2032e532ea73fd50c7137149c49afeaeb'
const BLEND = 'f3dac408fc9ed201941df1f96fb6825d48dd5557335625f9bfa1b5bd82f10731'
const WATER = '48830b25359d71d20ab2398db27d41f5b635862a216ac1eb39d28efb75d19708'

const CUTS = ['narrow', 'unshadowed', 'rectless', 'sunless', 'localless', 'lobeless'] as const
/** Every contract key: bit `k` of the rank sets `CUTS[k]`. */
const KEYS = Array.from(
  { length: 1 << CUTS.length },
  (_, bits) =>
    Object.fromEntries(CUTS.map((cut, k) => [cut, (bits & (1 << k)) !== 0])) as ContractKey,
)

const digest = (texts: string[]) => {
  const hash = createHash('sha256')
  for (const text of texts) hash.update(text).update('\0')
  return hash.digest('hex')
}

test('the blend vertex stage emits the same text, lobed and lobeless', () => {
  assert.equal(digest([true, false].map((lobes) => blendVertexWgsl(lobes))), VERTEX)
})

test('the blend module emits the same text under every contract key', () => {
  assert.equal(digest(KEYS.map((key) => blendShader(key))), BLEND)
})

test('the water composite emits the same text under every key, bounded or not', () => {
  const texts = [false, true].flatMap((unbounded) =>
    KEYS.map((key) => waterCompositeShader(unbounded, key)),
  )
  assert.equal(digest(texts), WATER)
})
