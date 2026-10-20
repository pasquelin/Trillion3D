// The transparent programs' text, character for character, over every variant: the blend vertex
// stage lobed and lobeless and the blend module under every contract key, 66 texts. The digests pin the texts as the WGSL library
// assembles them, its declarations in their order; they prove no equivalence with an earlier text.
// A deliberate change to any WGSL these programs include, or to the order its fragments list their
// declarations in, takes new digests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { blendShader } from './shader.ts'
import type { ContractKey } from '../lighting/deferred/contractCuts.ts'

// Retaken when the lobed vertex came to read UV1 for a map's channels and pass them in `tri`.
const VERTEX = '450d08d959c6e44b91d6c395a2094841f95c066bf1cd4e791f114c0bb2486d5a'
// Retaken when the blend module took the diagnostic light views, the cell-gated verdict inputs and
// the coverage-writing additive layers.
const BLEND = '1f7dc43b038bd864abb826e459180ed6a8c65f1965d7328049505b43475a3f0c'

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

// Retaken when a map reading the second UV set (the record's `channels`) came to read it too.
test('a lobed vertex reads the second UV set only where its surface carries a lobe or a map reading it', () => {
  const text = wgslModule(blendVertexWgsl(true))
  assert.match(
    text,
    /if\(\(m\.lobes!=0u\|\|m\.channels!=0u\)&&pageHasUv1\(page,h\)\)\{uv1=pageUv1\(/,
  )
})
