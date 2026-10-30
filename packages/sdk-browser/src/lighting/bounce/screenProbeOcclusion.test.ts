// The screen probes' occlusion, hair and extra occlusion, the thin feature search, the conversion's waves, the short-range occlusion and the global illumination it gathers.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { fastAcos } from '../../../../math/src/wgsl/geometry.ts'
import { SP_QUANTIZE } from './screen/gatherWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { SP_THIN_FEATURE } from './screen/traceFeatureWgsl.ts'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'

const sources = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })), undefined, undefined, undefined, undefined, false)
const code = <K extends keyof typeof sources>(name: K) => sources[name]!.code

/** The greatest distance a gathered texel tells, in metres: the greatest half float, in centimetres. */
const MAX_HIT = 65504 / 100

/** The 8-bit unsigned normalised code the reference gives a hit distance, and the distance its filter reads back. */
const encoded = (d: number) =>
  d < 0 ? 0 : Math.round(Math.min(1, Math.sqrt(d / MAX_HIT) * (254 / 255) + 1 / 255) * 255)
const decoded = (code: number) => ((code / 255) ** 2 * MAX_HIT - 1 / 255) * (255 / 254)

test('the occlusion’s angles are the polynomial arc cosine: the normal’s from its saturated cosine, the horizons’ from their cosines as they are', () => {
  const occlusion = code('occlusion')
  assert.match(occlusion, /fn fastAcos\(/)
  assert.match(occlusion, /let cosNormal=saturate\(dot\(projected,V\)\/span\);/)
  assert.match(occlusion, /let angle=sign\(dot\(orthogonal,projected\)\)\*fastAcos\(cosNormal\);/)
  assert.match(occlusion, /let h0=-fastAcos\(horizon1\);/)
  assert.match(occlusion, /let h1=fastAcos\(horizon0\);/)
  assert.doesNotMatch(occlusion, /\bacos\(/)
  const arc = shaderRun<{ fastAcos: (x: number) => number }>(
    wgslModule(fastAcos),
    ['fastAcos'],
    {},
  ).fastAcos
  for (const x of [-1, -0.6, -0.1, 0, 0.3, 0.8, 1])
    assert.ok(Math.abs(arc(x) - Math.acos(x)) < 0.01, `cosine ${x}`)
})

test('the screen trace of a hair pixel starts the hair bias along its ray and casts none where hair hits are skipped; a hit on hair or on an unlit surface is dropped where the setting says', () => {
  const trace = code('traceScreen')
  assert.match(trace, /if\(probe\.hair\)\{origin\+=d\*sp\.screen\.x;\}/)
  assert.match(trace, /\(probe\.hair&&spFlag\(SP_FLAG_SKIP_HAIR_HITS\)\)/)
  assert.match(
    trace,
    /if\(spFlag\(SP_FLAG_SKIP_HAIR_HITS\)&&pixelModelOf\(hitFlags\)==\d+u\)\{return seen;\}/,
  )
  assert.match(
    trace,
    /if\(spFlag\(SP_FLAG_SKIP_UNLIT_HITS\)&&\(hitFlags&7u\)==1u\)\{return seen;\}/,
    'the unlit surface mark is the low bits of the surface flags',
  )
})

test('a ray is held to the intensity the setting names in the units of the pre-exposed light, which the probes’ light is not: the setting divided by the pre-exposure, and the depth the weights measure is the distance along the view in both projections', () => {
  const run = (perspective: boolean) =>
    shaderRun<{ spMaxRay: () => number; spDepthOf: (p: number[]) => number }>(
      wgslModule(spCommon([4, 2])),
      ['spMaxRay', 'spDepthOf'],
      {
        sp: { weights: [0, 0, 0, 10] },
        view: { preExposure: [2, 0, 0, 0] },
        reflectionView: { slab: [1, 0, 0, 1] },
        slabPerspective: () => perspective,
        surfaceLinearDepth: () => 7,
        viewEyeDistance: () => 3,
      },
    )
  assert.equal(
    run(true).spMaxRay(),
    5,
    'ten in the light exposed twice is five in the light unexposed',
  )
  assert.equal(run(true).spDepthOf([0, 0, 0]), 7, 'a perspective: the clip depth')
  assert.equal(
    run(false).spDepthOf([0, 0, 0]),
    3,
    'an orthographic projection: the distance along the view, not the device depth',
  )
})

test('the screen extra occlusion is stored as an eight-bit code, a ratio of no weight as zero as an eight-bit target stores it', () => {
  const { spExtraAoCode } = shaderRun<{ spExtraAoCode: (ao: number) => number }>(
    wgslModule(SP_QUANTIZE),
    ['spExtraAoCode'],
    {},
  )
  assert.equal(spExtraAoCode(Number.NaN), 0)
  assert.equal(spExtraAoCode(0.5), 128)
  assert.equal(spExtraAoCode(-0.25), 0)
  assert.equal(spExtraAoCode(4), 255)
  assert.equal(spExtraAoCode(Number.POSITIVE_INFINITY), 255)
})

test('the occlusion the spatial filter writes is kept as the 11-11-10 target holds a channel: six bits of mantissa, so a step of 2^-7 in [0.5, 1) and finer below', () => {
  const { spExtraAoFiltered } = shaderRun<{ spExtraAoFiltered: (ao: number) => number }>(
    wgslModule(SP_QUANTIZE),
    ['spExtraAoFiltered'],
    {},
  )
  assert.equal(spExtraAoFiltered(Number.NaN), 0)
  assert.equal(spExtraAoFiltered(0), 0)
  assert.equal(spExtraAoFiltered(1), 1)
  assert.equal(spExtraAoFiltered(0.5), 0.5)
  assert.equal(spExtraAoFiltered(0.5 + 0.003), 0.5)
  assert.equal(spExtraAoFiltered(0.5 + 0.0045), 0.5 + 1 / 128)
  assert.equal(spExtraAoFiltered(0.1), 0.099609375)
})

test('the thin feature search spreads its samples over texels of the pyramid’s base level: the ray’s displacement over twice that level’s extent, times a texel, one over the extent', () => {
  // A ray from (10, 50) along x over eighty pixels of a hundred, level z 0.5; the base level is fifty texels a side. A feature (a tile nearer than
  // the ray) lies from x = 13: four samples span 4 · 0.8 · 0.02 = 0.064 over the 0.8 left of the ray, 0.08 of its way, to x = 14.8; spread
  // over the image's own size, they would stop at 12.4 and miss it.
  const run = shaderRun<{
    spThinFeature: (
      start: number[],
      delta: number[],
      end: number,
      t: number,
      size: number[],
      steps: number,
    ) => boolean
  }>(wgslModule(SP_THIN_FEATURE), ['spThinFeature'], {
    hizLevels: {
      level: [
        [0, 100, 100, 0],
        [0, 50, 50, 0],
      ],
    },
    hizLevelCount: () => 5,
    hizTracePlanes: () => false,
    screenTileDepth: (p: number[]) => (p[0] >= 13 ? 0.1 : 0.9),
    hizOpaqueDepth: () => 0.9,
  })
  const ray = (steps: number) =>
    run.spThinFeature([10, 50, 0.5], [80, 0, 0], 1, 0, [100, 100], steps)
  assert.equal(ray(4), true, 'the last sample lies on the feature')
  assert.equal(ray(2), false, 'two samples stop at x = 11.6, before it')
  assert.equal(ray(0), false, 'no step, no sample')
})

/** The kernel sources of a shape. */
type Sources = Parameters<typeof screenProbeSources>
const casting = (
  shape: Sources[0],
  width?: Sources[1],
  waves?: Sources[2],
  march?: Sources[3],
  compaction?: Sources[4],
) => screenProbeSources(shape, width, waves, march, compaction, false)

test('the conversion sums its projection over the subgroups of the device when it has them, the lanes of each subgroup then added in the workgroup, else one thread a coefficient adds the texels in turn', () => {
  const shape = kernelShapeOf(screenProbeSettings({ screenProbeFilteringWaveOps: true }))
  assert.equal(shape.waveOps, true)
  assert.equal(
    kernelShapeOf(screenProbeSettings({ screenProbeFilteringWaveOps: false })).waveOps,
    false,
  )
  const serial = casting(shape).convert.code
  assert.doesNotMatch(serial, /subgroupAdd/)
  assert.match(serial, /for\(var i=0u;i<SP_TEXELS;i\+\+\)\{sum\+=basis\[i\*9u\+s\]\*light\[i\];\}/)
  for (const lanes of [32, 64]) {
    const waved = casting(shape, undefined, lanes).convert
    assert.match(waved.code, /enable subgroups;/)
    assert.match(waved.code, new RegExp(`const SP_WAVE:u32=${lanes}u;`))
    assert.match(waved.code, /let sum=subgroupAdd\(basis\[lane\*9u\+k\]\*light\[lane\]\);/)
    assert.match(waved.code, /for\(var w=0u;w<SP_WAVES;w\+\+\)\{sum\+=waveLight\[w\*9u\+s\];\}/)
    assert.doesNotMatch(waved.code, /for\(var i=0u;i<SP_TEXELS;i\+\+\)\{sum\+=basis/)
    assert.notEqual(
      waved.key,
      casting(shape).convert.key,
      'the kernels of the two sums are not shared',
    )
  }
})

test('the screen trace gives a ray up when few lanes of its subgroup are still marching, by the subgroups of 32 where the device has exactly those and by the workgroup’s memory else; with no minimum the text is the walk without that test', () => {
  const none = casting(kernelShapeOf(screenProbeSettings({}))).traceScreen
  assert.doesNotMatch(none.code, /,occupancy|screenMarchLane=|screenMarchHolds/)
  const asked = kernelShapeOf(screenProbeSettings({ screenProbeScreenTracesMinimumOccupancy: 8 }))
  assert.equal(asked.occupancy, true)
  assert.equal(kernelShapeOf(screenProbeSettings({})).occupancy, false)
  const native = casting(asked, undefined, 0, 'native').traceScreen
  assert.match(native.code, /enable subgroups;/)
  assert.match(native.code, /let marched=spScreenMarch\(aimed,sp\.frames\.w\);/)
  assert.match(
    native.code,
    /if\(aimed\.live\)\{seen=spScreenEnd\(probe,aimed,marched,direction,noise\);\}/,
  )
  const polyfill = casting(asked, undefined, 0, 'polyfill').traceScreen
  assert.match(polyfill.code, /screenMarchLane=lane;/)
  // One slot a thread of the group: the rays of a probe, `side` along a side.
  assert.match(
    polyfill.code,
    new RegExp(`var<workgroup> screenMarchWalking:array<u32,${asked.side ** 2}>;`),
  )
  assert.notEqual(native.key, polyfill.key)
  assert.notEqual(native.key, none.key)
})

test('the short-range occlusion keeps a visibility bitmask of 32 sectors a slice where asked, the reference’s step: the sample’s front and back angles, ored, and a slice’s visibility the sectors left open', () => {
  const plain = casting(kernelShapeOf(screenProbeSettings({})))
  assert.doesNotMatch(plain.occlusion.code, /spOccludedSectors|SP_SECTOR_COUNT/)
  const shape = kernelShapeOf(screenProbeSettings({ screenProbeOcclusionVisibilityBitmask: true }))
  assert.equal(shape.occlusion.bitmask, true)
  const sources = casting(shape)
  const code = sources.occlusion.code
  assert.match(code, /let start=u32\(low\*f32\(SP_SECTOR_COUNT\)\);/)
  assert.match(code, /let width=u32\(ceil\(\(high-low\)\*f32\(SP_SECTOR_COUNT\)\)\);/)
  assert.match(
    code,
    /return \(0xFFFFFFFFu>>\(SP_SECTOR_COUNT-min\(width,SP_SECTOR_COUNT\)\)\)<<start;/,
  )
  assert.match(
    code,
    /let fractions=saturate\(\(direction\*-vec2f\(front,back\)\+angle\+0\.5\*PI\)\/PI\);/,
  )
  assert.match(code, /1\.0-f32\(countOneBits\(occluded\)\)\/f32\(SP_SECTOR_COUNT\)/)
  assert.notEqual(sources.occlusion.key, plain.occlusion.key)
})

test('without the horizon search the occlusion casts rays over the furthest depth, as many as the quality asks, and keeps the share left open and their mean direction', () => {
  const rays = (screenProbeQuality: number) =>
    kernelShapeOf(
      screenProbeSettings({ screenProbeOcclusionHorizonSearch: false, screenProbeQuality }),
    ).occlusion.rays
  assert.deepEqual([rays(1), rays(2), rays(5.9), rays(6)], [4, 8, 8, 16])
  assert.equal(kernelShapeOf(screenProbeSettings({})).occlusion.rays, 0)
  const shape = kernelShapeOf(screenProbeSettings({ screenProbeOcclusionHorizonSearch: false }))
  const code = casting(shape).occlusion.code
  assert.match(code, /const SP_RAYS:u32=4u;/)
  assert.match(code, /ssCast\(spFixedRay\(s\.P,d,reach,slope\),0\.2,4u,interleavedGradientNoise\(/)
  assert.match(code, /if\(!\(traced\.found&&!traced\.uncertain\)\)\{\n\s*open\+=1\.0;/)
  assert.match(code, /let found=spStochasticAo\(pixel,s\);/)
  assert.doesNotMatch(
    casting(kernelShapeOf(screenProbeSettings({}))).occlusion.code,
    /spStochasticAo/,
  )
})

test('the short-range global illumination is gathered by the horizon search alone: the steps go on past the occlusion’s reach, the light of the last image weighed by the share of the horizon a sample raises, written beside the occlusion', () => {
  const on = (extra: object) =>
    kernelShapeOf(screenProbeSettings({ screenProbeShortRangeGI: true, ...extra }))
  assert.equal(on({}).shortRangeGi, true)
  assert.equal(on({ screenProbeOcclusionVisibilityBitmask: true }).shortRangeGi, false)
  assert.equal(on({ screenProbeOcclusionHorizonSearch: false }).shortRangeGi, false)
  assert.equal(kernelShapeOf(screenProbeSettings({})).shortRangeGi, false)
  const plain = casting(kernelShapeOf(screenProbeSettings({}))).occlusion
  assert.doesNotMatch(plain.code, /spHorizonLight|giOut/)
  const code = casting(on({})).occlusion.code
  assert.match(code, /for\(var n=0u;n<u32\(sp\.gi\.y\);n\+\+\)\{/)
  assert.match(code, /let fade=1\.0-saturate\(radius\/f32\(sp\.size\.x\)\*5\.0\/sp\.gi\.x-4\.0\);/)
  assert.match(code, /if\(n<stepsAo\)\{/)
  assert.match(
    code,
    /let visibility=abs\(fastAcos\(cosine\)-fastAcos\(lit\)\)\/PI\*saturate\(dot\(s\.N,toSample\)\)/,
  )
  assert.match(
    code,
    /textureStore\(giOut,vec2i\(id\.xy\),vec4f\(gathered\*\(PI\/sp\.occlusion\.x\),0\.0\)\);/,
  )
  assert.match(code, /if\(strongest>sp\.gi\.z\)\{colour\*=sp\.gi\.z\/strongest;\}/)
  assert.notEqual(casting(on({})).occlusion.key, plain.key)
})

test('the temporal pass blends the short-range global illumination with its history, the four texels of the pixel’s reprojection by their weights, at the share of the light, and keeps it for the next image', () => {
  const plain = casting(kernelShapeOf(screenProbeSettings({}))).temporal
  assert.doesNotMatch(plain.code, /giHistory|spKeptGi/)
  const sources = casting(kernelShapeOf(screenProbeSettings({ screenProbeShortRangeGI: true })))
  const code = sources.temporal.code
  assert.match(
    code,
    /var gathered=select\(vec3f\(0\.0\),textureLoad\(giNew,pick\.cell\)\.rgb,occluded\);/,
  )
  assert.match(code, /gathered=mix\(spKeptGi\(h\),gathered,share\);/)
  assert.match(
    code,
    /sum\+=textureLoad\(giHistory,h\.texel\+vec2i\(i32\(i&1u\),i32\(i>>1u\)\)\)\.rgb\*h\.weights\[i\];/,
  )
  assert.match(
    code,
    /textureStore\(giOut,at,vec4f\(select\(gathered,vec3f\(0\.0\),noHistory\),0\.0\)\);/,
  )
  assert.notEqual(sources.temporal.key, plain.key)
})
