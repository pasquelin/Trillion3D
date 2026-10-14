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

const VERTEX = '855c1d53819473b8c1ef44b9271e1ed420878a2c6bd62af05a1b3ebc9ded0f7e'
const BLEND = '8ea50fd6a2128460aafa409247d3df3f4eab6e32cabd7d6cb6524631e1a9a4a3'
const WATER = 'a8577a79a7e0a7f5640219aba0eda127605d512bde22ce88dce495494b4c8a82'

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

test('a lobed vertex reads the second UV set only where its surface carries a lobe', () => {
  const text = wgslModule(blendVertexWgsl(true))
  assert.match(text, /if\(m\.lobes!=0u&&pageHasUv1\(page,h\)\)\{uv1=pageUv1\(/)
})
