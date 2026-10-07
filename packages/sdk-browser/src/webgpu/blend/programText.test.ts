// The transparent programs' text, character for character, over every variant: the blend vertex
// stage lobed and lobeless, the blend module and the water composite under every contract key (the
// composite bounded and unbounded), 194 texts. The digests pin the texts the WGSL library writes,
// which differ from the former templates' only where a library call took the place of an
// expression. That equivalence was established once, on all 194 texts against the former ones: each
// call inlined, its constants written as f32, parentheses kept wherever they set association, the
// two texts matched declaration by declaration. A deliberate change to any WGSL these programs
// include takes new digests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { blendShader } from './shader.ts'
import { waterCompositeShader } from '../water/compositeWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'

const VERTEX = '9fff4b908b2605e991ef2e27d7abdf1bdf1314d1c656ff09311c40736c3424e6'
const BLEND = '77c36a75ba06a8dee5c1695b1789c379ddac62cf28458b28bc1a63edbac2a535'
const WATER = '1db9de74f4cc6994d3acf93f91c658d159e99d894e92933cac01ea2417448dbd'

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
  assert.equal(digest([true, false].map((lobes) => wgslModule(blendVertexWgsl(lobes)))), VERTEX)
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
