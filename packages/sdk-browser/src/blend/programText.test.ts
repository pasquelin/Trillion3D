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
import { material } from '../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../sdk-core/src/world/texture/texture.ts'
import { isProgram, programOf } from '../materials/graph/surfaceProgram.ts'
import { GRAPH_SHADING_MODELS } from '../../../sdk-core/src/world/material/graph/outputs.ts'
import { PIXEL_MODEL } from '../materials/surface/pixelModel.ts'
import { LIGHTLESS_MODEL } from '../materials/surface/translucencyLighting.ts'
import { FLAG_LIT } from '../visibility/types.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'

// Retaken when the vertex came to pass the item's responsiveness code above the triangle's rank
// (`TRI_RESPONSIVE_SHIFT`), the page reads drew a voxel row's bricks as boxes (`voxelWgsl.ts`), and
// the lobed vertex took the one texture set past the first its maps name (`channelsAlt`), the view
// came to hold the pre-exposure every light is written multiplied by (`preExposure`), a view with a
// plane draws with a module of its own (`clipping`), and the record came to carry its graph's word,
// neutral for a graph's surface.
// and the view gained the wall clock beside the world's time (`realTime`, `materials/graph/clocks.ts`),
// and then a copy of the tone table's baking words (`bake`, `viewLayout.ts`), which the layers drawn on display values show their
// colour through, and then the light buffer lost its sky table by direction (`LIGHT_AIR_MEMBERS`), the sky
// read of a point answering the sky light's cube alone (`skyRadianceAt`), and then the item flags gained
// the marks of the shadow reads a surface asks for itself (`translucentMarksFrom`, `vertexWgsl.ts`), and then
// the item flags gained the two bits that say how its surface is lit (`translucencyLightingFlags`,
// `lighting/translucency/modeWgsl.ts`), and then the stage left an item of the other pass of the image
// out of the draw (`otherPass`, the item's and the view's `translucencyPass`), its argument renamed off the
// language's reserved word `pass`,
// and then the code shrank to the two bits of the responsiveness (`RESPONSIVE_MASK`), and then a map's
// texture set took three bits of the channels word, the eight sets a page carries (`MAP_CHANNEL_BITS`), and then the record gained an
// eye's distance of the iris (`irisDistance`).
// The object's holdout bit joined the triangle word (`TRI_HOLDOUT_SHIFT`).
// The view joined the translucency global illumination volume's grid and slices' law (`giGrid`, `giZ`).
// The vertex stage no longer leaves an item of another pass out (`otherPass`, the view's `translucencyPass` and the item's are gone): each draw expands its own items alone (`expand/expansionViews.ts`).
// Retaken for the vertex stage's triangle word: the item's lighting channels and the material's facts it carries for the fragment (`TRI_LIGHTING_CHANNELS_SHIFT`, `TRI_MATERIAL_SHIFT`).
// Retaken for the sky material's flag in the triangle word (`MATERIAL_FLAG.sky`): the opaque layer a sky surface writes (`blendSurface`).
// Retaken for the translucent layers drawn smaller than the image (`translucencyScale.ts`): the view's `reduced` ratio, which the vertex stage's pixel
// measure (the facing test) multiplies by (the line's width counts image pixels, whatever the size drawn at), and the function the fragment entries scale their pixel back by (`sceneVsOut`): both (declared once, with the interpolants' structure) leave
// the text's results as they were at the ratio 1 every other pass holds.
const VERTEX = '24c5a5c50db6fd2c93f0ba5b3893a845cfe636c9a9de85cfd89205844840f276'
// Retaken when the blend module took that vertex, the per-material responsiveness it writes for
// the temporal pass where its material asks one, and the stored tangents' frame in a
// module of its own (`tangentFrameWgsl.ts`) for the normal map and the lobes both, and then the
// sky: the surfaces read the sky light's diffuse light (`environmentSky`, then the volume's fade to it,
// `translucentSky`), the reflections' environment reads the sky by direction (`reflectionEnvironment`), and then the fog
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
// (`reflectionClampRay`) and read the trace's settings from the view (`reflectionView.lobe`, `.taps`, `.denoise`),
// and then the record gained its graph's word, the view the clock, the lighting a per-pixel
// reflectance (`surfaceF0`), a graph's anisotropy its law, and then the film curve's numbers came to be a structure its functions read (`Film`, `filmicFromAp1`),
// and then the sky light's first terms came to be read apart from its colour (`skyHarmonicsSimple`),
// and the view gained the wall clock beside the world's time (`realTime`, `materials/graph/clocks.ts`).
// and the fog's composition came to be a module of its own (`fogCompose.ts`), the volume's law one function (`fog/lawWgsl.ts`)
// and the light buffer a block of the local fog volumes (`localFog`),
// and then the display route ran the baking's chain on the view's copy of its words (`displayRoute`, `lighting/toneBakeWgsl.ts`: the
// white balance, the grade, the film curve or the standard output transform with its hue tables, the transfer), where it had evaluated
// the film curve at its defaults, and then the reach table's weight at the hue's wrap became the distance past the lower entry
// (`acesReachAt`), and then the air's block took a twentieth slot, the planet's place on the ground
// plane (`ATMOSPHERE_SLOT.planetPlace`), which the light buffer's struct counts, and then the sun's far-shadow distance in the
// shadow maps' projection record became its edge (`farShadowEdge`, `sunCascades`), and then the
// haze's read took the volume's kind and an orthographic view's distance along its direction
// (`viewHazeFunction`, `VIEW_SLOT.ortho`), and then every page position came to call the offset of its row's
// surface (`pageWpoLocal`, `PageInfo.wpo`: a default of none, `wpoGraphWgsl.ts` the real one),
// and then the display route's chain gained the standard output transform's first version
// (`aces13Display`, `lighting/aces/aces13Wgsl.ts`), the glow's measures the two curves share (`RRT_MEASURES_WGSL`) and
// the table's range cut before the transform, and the display value read through the finite and storable cuts (`storableWgsl.ts`),
// and then the graphs' frame (the clocks and the camera of the image, one uniform: `graphFrameWgsl.ts`) replaced the clocks the
// table kept, an item carried the words of its object's offset (`wpoDisableSq`, `wpoCentre`, `wpoMost`), and the page geometry's
// offset became `pageOffset`, a brick of voxels taking the offset at the centre of its box, and then the light
// buffer lost its sky table by direction, and the fog's observer reach came to be written from the
// constant the view block is written with (`FOG_OBSERVER_REACH`), and then the height fog came to
// ask the view whether it shows it (`heightFogShown`) and the sky light to light it
// (`fogSkyLightStrength`, `fogSkyLightColour`, `heightFogLaw`), and then the coloured shadow of the
// translucent casters left the module (the transmittance binding and its reads), a rectangle light
// came to be lit as a point light unless the project switch `translucentRectLights` holds, and the
// surfaces' own shadow reads (`translucentMarksFrom`) were laid in the shadow code, and then the view
// gained the translucency lighting volume's boxes (`BlendView.volumeCorner`), the layer's surface was
// set apart from its lights (`blendLightsSet`) and the layout one more storage texture, the volume,
// and then the view gained the depth of field's split and the pass's side of it, and then the layer
// wrote its responsiveness mark where it covers a pixel (`blendResponsive`) in place of a share at its coverage,
// and then a graph's context took the direction an orthographic view looks along (`mgViewForward`), and then the
// as-is share lost its second channel: a layer's share output is written 0, and the particles' and the transmissive
// layers' reactive outputs left the module, and then the as-is share left it: a debug view's as-is pixels are
// composed from the surfaces after the temporal pass, the display layers and the responsiveness one location
// down, and then the stage's `otherPass` took an argument that is no reserved word, and then the
// view named a set of passes it draws (`otherPass` tests a bit of it, three passes) and the item carried
// the clip value of its surface's opacity mask, which the responsiveness mark is windowed by.
// The responsiveness left the colour pass for a pass of its own (`fsBlendResponsive`).
// The shading models a graph picks per pixel joined the light term and the lobes' hooks (skin, hair, eye), and then the preintegrated
// environment BRDF replaced the split-sum weight of every reflection, the subsurface profile joined the models and the pow5 of the Fresnel.
// Retaken last, once every blend change of the day was in (the ACES and film tone chain, the local fog, the clear coat and cloth lobes, the
// environment BRDF, the sky reads, the shadow reads, the profile and thin subsurface models): each added declaration traces to one of them.
// The alpha holdout joined: its accumulation stage (`fsBlendHoldout`, `holdoutOut`) and the fog's transmittance it reads (`fogThrough`, `fogHeld`).
// The fog went per blend mode (`foggedBy`, `fogThrough`), the layer's hdr writes black for a held-out primitive (`holdoutPrimitive`, the view's `holdout` word).
// The holdout stage flattened to one covers/held/seen ladder (`fsBlendHoldout`), the modulating layers' fog squared in one helper
// (`fogThroughModulating`), the inscattering share a function (`inscatterShare`), the fog opt-out and the mode tests one predicate each.
// The fog of a blended surface went per vertex (`fogLaidFar`, `fogLocalVertex`, `blendFog`, `fogVolumeOver`, the layer in one extra, the per-pixel mark in the triangle word) and the material record gained `fogPerPixel`; a program whose surfaces all take their fog per pixel holds none of its lanes; the cluster identity words moved behind the spans (`clusterIdentity`); the volume lights the translucent and additive layers alone (`blendLightsOf`).
// The see-through surfaces' indirect light became one fetch of the translucency global illumination volume (`translucentGiWgsl`) in place of a gather of the
// world's probes, their reflection behind the front surface the environment alone (`reflectionEnvironmentOf`).
// The volume's read drew the sky only where its fade leaves room for it, shared the harmonics' irradiance with the translucency lighting volume
// (`tvIrradiance`), and left the surfaces to give back its irradiance themselves (`lambertDiffuse`: the water reads it once).
// Retaken when the layer's light came to follow its material's lighting mode alone (`blendLightsOf`: forward, else none or the volume's), the plain module declaring the mode's codes, and its fog's text a fog-free thin layer reads no fog in.
// The vertex stage carries the shading model in the flags (`blendShadingFlags`: the unlit one clears the lit flag and the base colour, the others leave their pixel model for the hair's reflection, `blendUnreflecting`), the lightless lane a function (`lightlessLane`), and the local fog's vertex lost its second count guard.
// Retaken when the shading model's flags came from one rule (`shadingFlagsOfNumber`, `shadingNumberOfModel`) and a medium from `translucencyMedium`.
// The item's flags lost the diagnostic view's code (its bits are the pixel model's; the fragment reads the code from `uni.viewFlags`), a
// fragment that reflects nothing (a hair, a medium) takes no reflection (`forwardIndirect`'s `reflects`), and `blendLightsOf` takes the flags.
// The fragment took the lighting program a pipeline constant (`BLEND_LIGHTING`, `blendLightsOf`), the unlit one closing the lit path, and the vertex stage lost `otherPass`.
// The reflection lobe lost its probe bands and long axis (`reflectionLobeOf`), the environment alone standing for the probes' field.
// The standard material's Fresnel took the specular grazing value (`slabF90`, `fresnelSchlick(f0,f90,cosine)`) and the split sum its F90 (`math/src/wgsl/lighting.ts`); retaken for the sixth cut (`contactless`, always set in a blend program) and the occlusion that left the diffuse and toon models of a shadowed light.
// Retaken when the light terms' documentation and cache irradiance dependencies were reworded in the text (`lightTermsWgsl`) and the shadow factor became a declared block (`shadowFactorWgsl`).
// Retaken when the translucency global illumination volume's ambient and directional light were stacked in one texture and the freed slot
// bound the light profiles' atlas: the text moved in three places and nowhere else (the digest held through the run before). (1) The volume:
// one declaration `translucencyGiVolume` at binding 21 in place of two at 21 and 26, read by `giSampleVolume` (two `stackedSample` halves)
// in place of `giSampleVolumes`, which left `GI_SAMPLE_WGSL`. (2) Every key that is not `profileless` holds the profile read
// (`lightProfileOfWgsl`: the atlas at binding 26, its sampler at 49, `lightProfileMultiplier`, `lightProfileOf`) in place of the stand-in that
// answered 1 (`NO_LIGHT_PROFILE_WGSL`). (3) The light loop's term of a profiled light multiplies by it.
// Retaken (with the vertex stage) for the lighting lot of 28/10: the blend view's camera-map words in its padding (`volumeCamera`), the fog
// a blended surface takes through the heterogeneous volumes' camera map (`blendVolumeFog`), the shared shading and declared-term text
// (`SHADING_TEXT`, `DECLARED_TERM_TEXT`), the front layer's depth carried by its traced radiance (`FRONT_TRACED_FORMAT`), and the direct
// loops' sine through `sinFromCosUnclamped`. The proofs of the blend on the GPU did not pass before this lot either.
// Retaken for c9's fourth deduplication sweep (29/10): the held layers' read (`loadHeld`) and the packed tables' reads
// (`packedTableWgsl`) declared once: the same operations.
// Retaken for the translucent surfaces' scene reflection (29/10): the reflection view's `translucent` words, which every blend reads;
// a device that does not grant the scene reflection keeps the environment read, its text otherwise the same.
// Retaken for the sky meshes capture (29/10): a sky surface writes an opaque layer (`blendSurface`: its cutout alone reads the base alpha),
// and the fog beyond a ray is worked out over any reach (`fogBeyondAlong`, `fogBeyondWith` its endless one).
// Retaken for the simple lights' word (30/10): the lights' tile slice declares the simple light word, `sampledTakes` reads it, and its text holds no backtick.
// Retaken for the translucent layers drawn smaller than the image (`translucencyScale.ts`): the layers' fragment entries hand their body the interpolants
// at the image's pixel (`layerEntry`), the view's `reduced` ratio being 1 outside the passes of the smaller layers.
const BLEND = 'f3bd1ace4d11b8e7cc1712406434a73f5ccddf06fb33d141c907ea63811cee14'

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

/** The program a translucent surface's graph compiles to for the transparent pass. */
function translucentProgram() {
  const graph = material.graph('surface')
  const read = graph.textureSample(new WorldTexture(), { uv: graph.texCoord(1) })
  graph.output('baseColor', graph.channel(read, 'rgb'))
  graph.output('opacity', graph.channel(read, 'a'))
  graph.output('normal', graph.constant(0, 0, 1))
  const program = programOf({ graph, transparent: true })
  assert.ok(isProgram(program), 'the graph compiles')
  return program
}

test('a blend module holds the code of a graph only where an item wears one', () => {
  const plain = blendShader({})
  assert.doesNotMatch(plain, /BlendGraph|blendGraphEval|derivative_uniformity/)
  assert.doesNotMatch(wgslModule(blendVertexWgsl(true)), /m\.graph/)
  const program = translucentProgram()
  const text = blendShader({}, { graphs: [program] })
  // The program's own functions, the switch that picks them by the id its values carry, and the
  // derivatives they take among the quad's: each said where it is taken, the module's other
  // functions keeping the uniformity check.
  assert.doesNotMatch(text, /^diagnostic\(off,/m)
  assert.match(text, /@diagnostic\(off,derivative_uniformity\) fn blendGraphEval\(in:VSOut\)/)
  assert.match(text, /@diagnostic\(off,derivative_uniformity\) fn blendGraph_\w+\(in:VSOut/)
  assert.match(text, new RegExp(`case ${program.id}u:\\{return blendGraph_\\w+\\(in,first\\);\\}`))
  // Evaluated once, with the fragment's screen derivatives, before any of its tests.
  assert.match(
    text,
    /fn blendGrads\(in:VSOut\)->BlendGrads\{let unitNormal=unitOrZero\(in\.normal\.xyz\);return BlendGrads\(dpdx\(in\.uv\.xy\)[^]*,blendGraphEval\(in\)\);\}/,
  )
  assert.match(
    text,
    /fn blendBase\(in:VSOut,g:BlendGrads\)->vec4f\{if\(g\.graph\.id!=0u\)\{return vec4f\(g\.graph\.rgb,g\.graph\.opacity\);\}/,
  )
  // Its textures' footprints come from the contexts beside, which the screen derivatives give.
  assert.match(text, /mgNeighbour\[0\]\.uvs=array<vec2f,8>\(in\.uv\.xy\+dpdx\(in\.uv\.xy\)/)
  // Its two clocks are the view's: the world's time, and the wall clock, which a pause leaves running.
  assert.match(text, /ctx\.time=uni\.time;ctx\.realTime=uni\.realTime;/)
})

test('the stages of one module list one blend surface, with the graphs or without', () => {
  const programs = [translucentProgram()]
  // A conflict between the stages' own copies of the surface would be refused by the assembler.
  const code = blendShader({}, { stage: transmitWgsl({}, false, programs), graphs: programs })
  assert.equal(code.match(/fn blendGrads\(/g)?.length, 1)
  assert.equal(code.match(/struct BlendGraph\{/g)?.length, 1)
  const front = blendFrontShader(1, undefined, programs)
  assert.equal(front.match(/fn blendGraphEval\(/g)?.length, 1)
  assert.doesNotMatch(blendFrontShader(1), /blendGraphEval/)
})

/** The program a translucent surface's graph compiles to when it picks its shading model per pixel. */
function modelProgram(model: number) {
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(0.8, 0.5, 0.2))
  graph.output('emissive', graph.constant(0.3, 0.2, 0.1))
  graph.output('opacity', graph.constant(0.5))
  graph.output('shadingModel', graph.constant(model))
  const program = programOf({ graph, transparent: true })
  assert.ok(isProgram(program), 'the graph compiles')
  return program
}

test('a graph that picks its shading model per pixel gives the blend fragment and the front stage the item flags that model makes', () => {
  const program = modelProgram(GRAPH_SHADING_MODELS.hair)
  const text = blendShader({}, { graphs: [program] })
  assert.match(text, /out\.model=i32\(round\(mgShadingModel\w*\(ctx,g\)\)\);out\.flags\|=64u;/)
  assert.match(
    text,
    /if\(out\.model==0\)\{out\.rgb=[^;]*;out\.emissive=vec3f\(0\.0\);out\.metal=0\.0;out\.ao=1\.0;\}/,
  )
  assert.match(text, /let flags=blendGraphFlags\(in\.ids\.y,g\.graph\);/)
  assert.match(
    blendFrontShader(1, undefined, [program]),
    /frontReflects\(blendGraphFlags\(in\.ids\.y,g\.graph\)\)/,
  )
  // A module whose graphs pick none keeps the item's flags whole, and the blend without graphs reads its own.
  const plain = blendShader({}, { graphs: [translucentProgram()] })
  assert.match(plain, /fn blendGraphFlags\(flags:u32,g:BlendGraph\)->u32\{return flags;\}/)
  assert.match(blendShader({}), /let flags=in\.ids\.y;/)
})

test('the flags a per-pixel shading model makes follow the rules of the record’s: unlit unlit, the hair reflects nothing, the volume lights the default lit and the thin subsurface alone', () => {
  const run = (model: number, flags: number) =>
    shaderRun<{ blendGraphFlags: (flags: number, g: object) => number }>(
      blendShader({}, { graphs: [modelProgram(model)] }),
      ['blendGraphFlags'],
      {},
    ).blendGraphFlags(flags, { flags: 64, model })
  const LIT = FLAG_LIT
  const pixel = (flags: number) => (flags >>> 25) & 15
  const lane = (flags: number) => (flags >>> 17) & 7
  const base = (LIT | (3 << 25)) >>> 0 // lit, a stale pixel model number in its bits
  assert.equal(run(GRAPH_SHADING_MODELS.unlit, base) & LIT, 0)
  assert.equal(pixel(run(GRAPH_SHADING_MODELS.hair, base)), PIXEL_MODEL.hair)
  assert.equal(
    pixel(run(GRAPH_SHADING_MODELS.defaultLit, base)),
    0,
    'the default clears the stale number',
  )
  assert.equal(pixel(run(GRAPH_SHADING_MODELS.subsurface, base)), PIXEL_MODEL.subsurface)
  for (const [name, model] of Object.entries(GRAPH_SHADING_MODELS)) {
    const lit =
      model === GRAPH_SHADING_MODELS.defaultLit || model === GRAPH_SHADING_MODELS.subsurface
    if (model === GRAPH_SHADING_MODELS.unlit) continue
    assert.equal(
      lane(run(model, base)) === LIGHTLESS_MODEL,
      !lit,
      `${name}: lightless lane unless the volume lights it`,
    )
    // A model the volume lights brings the record's lightless lane back to the standard one; the others keep it.
    assert.equal(
      lane(run(model, base | (LIGHTLESS_MODEL << 17))),
      lit ? 0 : LIGHTLESS_MODEL,
      `${name}: the lightless lane follows the pixel's model`,
    )
    // A surface of another model keeps its lane.
    assert.equal(
      lane(run(model, base | (6 << 17))),
      6,
      `${name}: the shadow catcher keeps its lane`,
    )
  }
})
