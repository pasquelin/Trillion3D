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
// module of its own (`tangentFrameWgsl.ts`) for the normal map and the lobes both, and then the
// sky: the probes carry the sky light's diffuse light (`indirectGathered`, `environmentSky`), the
// reflections' environment reads the sky by direction (`reflectionEnvironment`), and then the fog
// took the height law's fields: its block grew to six `vec4`, its text to the law's steps, and then
// a probe that holds no light yet leaves its share of a point unanswered (`probeFieldWgsl`), the
// indirect light of a point is one fragment (`indirectWgsl.ts`), and then that share goes to the sky
// light only where one shines, a scene with none keeping the probes' mean (`indirectGathered`), and
// then the probes came to be held by a pool, named by a table of the atlas (`tableEntry`,
// `poolProbe`) with the level each carries, over levels that follow the eye (`bounceRead`), and
// then a probe's distance along a direction came to be read from its two distance vectors
// (`distanceAlong`), the one rule its neighbours' filter reads them by too, and then the fog's height
// law came to be written over a ray apart from its point (`heightFogAlong`), for the sky's ray that
// leaves the scene (`fogBeyond`), and then the fog read whether an atmosphere shows by one text, and
// gained the test of a background no sky is drawn on (`fogsBackground`).
const BLEND = 'cd675409d1938dbc772be35223096a8147c241ed2880bf35fc8c24bf7458dc12'

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
