// The transparent programs' text, character for character, over every variant: the blend vertex
// stage lobed and lobeless, the blend module and the water composite under every contract key (the
// composite bounded and unbounded), 194 texts. The digests pin the texts the WGSL library writes;
// a deliberate change to any WGSL these programs include takes new digests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { blendShader } from './shader.ts'
import { waterCompositeShader } from '../water/compositeWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'

const VERTEX = '4e22ec3f552fbe705ecd04435cf5f29fc27097df3ec09783f5a2bd544a704984'
const BLEND = '53206ed453f900835990e001cf9bc3eb25af6abf14e9f5f79c12dc3ec12bbfcf'
const WATER = 'ec8e5c181b70c19b2accdf4aad2364b66cc0afaa4740c957d0775afffa70a7ee'

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
