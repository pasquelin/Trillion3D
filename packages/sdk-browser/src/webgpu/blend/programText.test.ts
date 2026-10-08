// The transparent programs' text, character for character, over every variant: the blend vertex
// stage lobed and lobeless, the blend module and the water composite under every contract key (the
// composite bounded and unbounded), 194 texts. The digests pin the texts as the WGSL library
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

const VERTEX = 'd51608ee9743853075481564daeb794b4c111dad439f1315d606f9997706a545'
const BLEND = '11a656ce37e7065c911c22407231a33637a7acbaf3bc61293763c307b7f5487d'
const WATER = 'b9650ffc3d30427e3563b38386ec1ea73226ab8023735fa10d25692c199bf1b4'

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

test('the water composite text is pinned under every key, bounded or not', () => {
  const texts = [false, true].flatMap((unbounded) =>
    KEYS.map((key) => waterCompositeShader(unbounded, key)),
  )
  assert.equal(digest(texts), WATER)
})
