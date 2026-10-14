// The transparent programs' text, character for character, over every variant: the blend vertex
// stage lobed and lobeless, the blend module and the water composite under every contract key, 130
// texts. The digests pin the texts as the WGSL library
// assembles them, its declarations in their order; they prove no equivalence with an earlier text.
// A deliberate change to any WGSL these programs include, or to the order its fragments list their
// declarations in, takes new digests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { blendShader } from './shader.ts'
import { waterCompositeShader } from '../water/compositeWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'

const VERTEX = '090a3ab1c1d391f001287b6071fcb8e4cb4aa06b2cddbe36aecb6c0aee76e5b4'
const BLEND = 'a573ce3d38ea7a90bd93c76e03d1fe34ce226855f18d11d882c106c9dd3847c5'
const WATER = '1dc82a41dcc2767775441e75b897a3521293d2b9680d971ba0bc31c0574fb85c'

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

test('the blend vertex stage text is pinned, lobed and lobeless', () => {
  assert.equal(digest([true, false].map((lobes) => wgslModule(blendVertexWgsl(lobes)))), VERTEX)
})

test('the blend module text is pinned under every contract key', () => {
  assert.equal(digest(KEYS.map((key) => blendShader(key))), BLEND)
})

test('the water composite text is pinned under every key', () => {
  assert.equal(digest(KEYS.map((key) => waterCompositeShader(key))), WATER)
})
