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

const VERTEX = '9e40931dbb6e9bf96c7db888d1531d66d3701c4bde7c4e42d4f27fa1b0281ff8'
const BLEND = '8729b43a8b7f7aa9ac503c30a55f239ec32d31def50cb5a5354e096e88dfdd4e'
const WATER = '93e1ef113b7f58d40f860836b8bdf5c5001655c3b73f841c2f6b48224036a33a'

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
