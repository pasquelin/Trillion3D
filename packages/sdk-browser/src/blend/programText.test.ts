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

// Retaken when the vertex came to pass the item's history share code above the triangle's rank
// (`TRI_GIVEN_UP_SHIFT`), the page reads drew a voxel row's bricks as boxes (`voxelWgsl.ts`), and
// the lobed vertex took the one texture set past the first its maps name (`channelsAlt`).
const VERTEX = '4527231df79be64432298d76dcf283c314a39b64fa2f846f9f6ed30dd9a64ead'
// Retaken when the blend module took that vertex, the per-material history share it writes for
// the temporal pass where its material gives the history up, and the stored tangents' frame in a
// module of its own (`tangentFrameWgsl.ts`) for the normal map and the lobes both.
const BLEND = 'f5c3218b6eba5c5b02663e38ae98cee3625ebc3632c69384400f68fc2ea31c0e'

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

// Retaken when the texture sets a map reads grew to four (the record's two-bit `channels`).
test('a lobed vertex reads a set past the first only where a map of its surface or its lobes names one', () => {
  const text = wgslModule(blendVertexWgsl(true))
  assert.match(
    text,
    /var alt=channelsAlt\(m\.channels\);\s*if\(alt==0u&&m\.lobes!=0u\)\{alt=channelsAlt\(physicalAt\(m\.lobes\)\.channels\);\}\s*if\(alt!=0u&&pageHasUvSet\(page,h,alt\)\)\{uv1=pageUvSet\(/,
  )
})
