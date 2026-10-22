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
import { transmitWgsl } from './transmission/transmitWgsl.ts'
import { blendFrontShader } from './frontStageWgsl.ts'

// Retaken when the vertex came to pass the item's history share code above the triangle's rank
// (`TRI_GIVEN_UP_SHIFT`), the page reads drew a voxel row's bricks as boxes (`voxelWgsl.ts`), and
// the lobed vertex took the one texture set past the first its maps name (`channelsAlt`), and a
// device without clip distances came to test the pixel against the view's plane (`blendClipped`).
const VERTEX = 'c265a2e6e56e1bdf25ce7eb9869decef5e032cb0df2fe948f74ee268f0f6e7d4'
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
// gained the test of a background no sky is drawn on (`fogsBackground`), and then the reflections'
// screen march came to be two walks of the depth pyramid, picked by its levels uniform
// (`screenMarch`, `hizTrace`), and then the reflection view's block gained the share of a surface's
// depth the reference walk takes for its thickness (`thickness`), and then the fog's cubemap,
// volume and sampler were bound in the module and read where a pixel is fogged (`fogResourcesWgsl`),
// the volume's view being read from the light buffer, and the casters' memory, the blue noise and the
// front's radiance became read-only storage textures read by load (`loadOnlyTarget`).
const BLEND = '3464728866dad9adacf4b0096cbbe3d99f91d69c094f8548374f5d1d91ed6d08'

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

/** The fragment entries that take the vertex struct, each with whether the pixel test opens it. */
const fragmentEntries = (code: string) =>
  [
    ...code.matchAll(
      /@fragment fn (\w+)\(in:VSOut\b[^{]*\{(\s*if\(blendClipped\(in\)\)\{discard;\})?/g,
    ),
  ].map(([, name, guard]) => [name, !!guard] as const)

test('a device that has clip distances cuts at the view’s plane in the vertex stage, one that has none in each fragment entry', () => {
  const stage = transmitWgsl({}, false)
  for (const code of [
    blendShader({}),
    blendShader({}, { stage }),
    blendFrontShader(1),
    blendFrontShader(2),
  ]) {
    const entries = fragmentEntries(code)
    assert.ok(entries.length >= 1, 'entries read')
    assert.ok(
      entries.every(([, guarded]) => guarded),
      `${entries.map(([name]) => name)}`,
    )
    assert.ok(
      code.includes(
        'fn blendClipped(in:VSOut)->bool{return dot(uni.clipPlane.xyz,in.view)+uni.clipPlane.w<0.0;}',
      ),
    )
    assert.ok(!code.includes('clip_distances') && !code.includes('VSOutClipped'))
  }
  assert.ok(
    fragmentEntries(blendShader({}, { stage })).length >= 8,
    'the lit, covered and transmissive ones',
  )
  for (const code of [
    blendShader({}, { clip: true }),
    blendShader({}, { stage, clip: true }),
    blendFrontShader(1, true),
  ]) {
    assert.ok(
      code.indexOf('enable clip_distances;') >= 0 &&
        code.indexOf('enable clip_distances;') < code.indexOf('struct '),
    )
    assert.ok(code.includes('@builtin(clip_distances) clipDistances:array<f32,1>'))
    assert.ok(code.includes('fn vs(') && code.includes('->VSOutClipped{'))
    assert.equal(code.split('VSOutWithClip(out,1.0)').length, 2, 'a dropped lane is kept')
    assert.ok(code.includes('VSOutWithClip(out,dot(uni.clipPlane.xyz,out.view)+uni.clipPlane.w)'))
    assert.ok(!code.includes('blendClipped'))
    assert.ok(
      fragmentEntries(code).length >= 1 && fragmentEntries(code).every(([, guarded]) => !guarded),
    )
  }
})
