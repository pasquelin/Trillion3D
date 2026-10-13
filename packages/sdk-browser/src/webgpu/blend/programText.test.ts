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

const VERTEX = 'ac6a6d742d56ba9f3f5f77706d3b807eaa6725dd83d538063487db1df32b71df'
const BLEND = '468223c83a173a37d8ffa9b58df97b771c9ca567382292535ba42d053336729c'
const WATER = '26bfc7f802f392023f69e04d04d0fd886c7ae5e9e92098c81a8db63a035f4f2b'

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
