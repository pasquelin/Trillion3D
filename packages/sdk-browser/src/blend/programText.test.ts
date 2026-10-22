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
// the lobed vertex took the one texture set past the first its maps name (`channelsAlt`), the view
// came to hold the pre-exposure every light is written multiplied by (`preExposure`), and a view with
// a plane draws with a module of its own (`clipping`): its text holds no clipping code.
const VERTEX = 'e2ba8300621ede614f51709a2e74dd74976ac408a35d5df8936d50d45fd53566'
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
// front's radiance became read-only storage textures read by load (`loadOnlyTarget`), and then the
// layers came to write their light multiplied by the pre-exposure (`preExposed`), the sum clipped after it
// (`preExposedClipped`), and the sky light's cubes joined the reflection group, and then the fog
// started its ray at the view's clip plane (`heightFogAlong`, the plane in the fog's view block), and
// then took the fog's switches, its lobe and its observer from that block, and a light record its
// share in the volume (`DirectLight.volume`), and then the reflections' field stage held a ray's answer to a ceiling
// (`reflectionClampRay`) and read the trace's settings from the view (`reflectionView.lobe`, `.taps`, `.denoise`).
const BLEND = 'dc960cb1edde5f3a8232bc28b40ce15f12458bd6394d5a52ae9bfa632f05b20a'

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

/** What a module made to cut at the plane adds beyond the plain module, one way or the other. */
const PLANE_CODE = [
  'clip_distances',
  'VSOutClipped',
  'VSOutWithClip',
  'blendClipped',
  'uni.clipPlane',
]

test('the module of a view without a plane holds none of the clipping code, whatever stages it takes', () => {
  const stage = transmitWgsl({}, false)
  for (const code of [
    blendShader({}),
    blendShader({}, { stage }),
    blendFrontShader(1),
    blendFrontShader(2),
    wgslModule(blendVertexWgsl(true)),
    wgslModule(blendVertexWgsl(false)),
  ])
    for (const text of PLANE_CODE)
      assert.ok(!code.includes(text), `${text} is not in the module without a plane`)
})

test('a device without clip distances tests the pixel against the plane in each fragment entry, and only there', () => {
  const stage = transmitWgsl({}, false)
  const guard = /\n if\(blendClipped\(in\)\)\{discard;\}/g,
    clipFn = /\nfn blendClipped\(in:VSOut\)->bool\{[^}]*\}\n/,
    distanceFn = /fn planeDistance\([^}]*\}\n/
  for (const [plain, code] of [
    [blendShader({}), blendShader({}, { clipping: 'pixel' })],
    [blendShader({}, { stage }), blendShader({}, { stage, clipping: 'pixel' })],
    [blendFrontShader(1), blendFrontShader(1, 'pixel')],
    [blendFrontShader(2), blendFrontShader(2, 'pixel')],
  ]) {
    const entries = fragmentEntries(code)
    assert.ok(entries.length >= 1, 'entries read')
    assert.ok(
      entries.every(([, guarded]) => guarded),
      `${entries.map(([name]) => name)}`,
    )
    assert.ok(
      code.includes(
        'fn blendClipped(in:VSOut)->bool{return planeDistance(uni.clipPlane,in.view)<0.0;}',
      ),
    )
    assert.ok(!code.includes('clip_distances') && !code.includes('VSOutClipped'))
    // Those guards, that function and the plane's distance are all it adds: the plain module is
    // the rest, word for word.
    assert.equal(code.replace(guard, '').replace(clipFn, '').replace(distanceFn, ''), plain)
  }
  assert.ok(
    fragmentEntries(blendShader({}, { stage, clipping: 'pixel' })).length >= 8,
    'the lit, covered and transmissive ones',
  )
})

test('a device that has clip distances cuts at the view’s plane in the vertex stage', () => {
  const stage = transmitWgsl({}, false)
  for (const code of [
    blendShader({}, { clipping: 'distance' }),
    blendShader({}, { stage, clipping: 'distance' }),
    blendFrontShader(1, 'distance'),
  ]) {
    assert.ok(
      code.indexOf('enable clip_distances;') >= 0 &&
        code.indexOf('enable clip_distances;') < code.indexOf('struct '),
    )
    assert.ok(code.includes('@builtin(clip_distances) clipDistances:array<f32,1>'))
    assert.ok(code.includes('fn vs(') && code.includes('->VSOutClipped{'))
    assert.equal(code.split('VSOutWithClip(out,1.0)').length, 2, 'a dropped lane is kept')
    assert.ok(code.includes('VSOutWithClip(out,planeDistance(uni.clipPlane,out.view))'))
    assert.ok(!code.includes('blendClipped'))
    assert.ok(
      fragmentEntries(code).length >= 1 && fragmentEntries(code).every(([, guarded]) => !guarded),
    )
  }
})
