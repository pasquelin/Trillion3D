// The screen probes' rays, trace and gather as the reference runs them: the directions' probability, the screen trace's start, stop and hit, and the gathered light as the 8-bit and 11-11-10 targets hold it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { SP_QUANTIZE } from './screen/gatherWgsl.ts'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'

const sources = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })), undefined, undefined, undefined, undefined, false)
const code = <K extends keyof typeof sources>(name: K) => sources[name]!.code

/** The greatest distance a gathered texel tells, in metres: the greatest half float, in centimetres. */
const MAX_HIT = 65504 / 100

/** The 8-bit unsigned normalised code the reference gives a hit distance, and the distance its filter reads back. */
const encoded = (d: number) =>
  d < 0 ? 0 : Math.round(Math.min(1, Math.sqrt(d / MAX_HIT) * (254 / 255) + 1 / 255) * 255)
const decoded = (code: number) => ((code / 255) ** 2 * MAX_HIT - 1 / 255) * (255 / 254)

test('a gathered texel keeps its nearest hit as an 8-bit code of the square root of its share of the greatest distance, none as the code 0', () => {
  const run = shaderRun<{
    spHitCode: (distance: number) => number
    spHitFromCode: (code: number) => number
  }>(wgslModule(SP_QUANTIZE), ['spHitCode', 'spHitFromCode'], {})
  for (const d of [0, 0.02, 0.5, 3, 10, 200, MAX_HIT])
    assert.equal(run.spHitCode(d), encoded(d), `${d} m`)
  assert.equal(run.spHitCode(-1), 0, 'a texel no ray fell in')
  assert.equal(run.spHitCode(MAX_HIT), 255, 'the greatest distance')
  for (const code of [1, 17, 128, 255])
    assert.ok(Math.abs(run.spHitFromCode(code) - decoded(code)) < 1e-4, `code ${code}`)
  assert.ok(run.spHitFromCode(0) < 0, 'the code 0 is read as an invalid ray')
})

test('a gathered colour is dithered by a number of [0, 1) and held to the mantissas of an 11-11-10 target', () => {
  const run = shaderRun<{ spQuantize: (c: number[], e: number) => number[] }>(
    wgslModule(SP_QUANTIZE),
    ['spQuantize'],
    { spFlag: () => false, SP_FLAG_EXACT_LIGHT: 0 },
  )
  // Between 1 and 1 + 1/64, the unit of the red and green mantissas (six bits): a third of the way up.
  const between = [1 + 0.3 / 64, 1 + 0.3 / 64, 1 + 0.3 / 32]
  assert.deepEqual(run.spQuantize(between, 0), [1, 1, 1], 'a low draw rounds it down')
  assert.deepEqual(
    run.spQuantize(between, 0.999),
    [1 + 1 / 64, 1 + 1 / 64, 1 + 1 / 32],
    'a high one rounds it up, the blue by its coarser unit',
  )
  assert.deepEqual(run.spQuantize([0, 0, 0], 0.7), [0, 0, 0], 'black stays black')
})

test('the rays move the surface where the camera and its own motion put it, and keep the probability of the light in a half float', () => {
  const rays = code('rays')
  assert.match(
    rays,
    /let px=ndcToPixel\(spMotionOf\(vec2i\(pixel\),P,clip\.xy\/clip\.w\)\.ndc,size\);/,
  )
  // The last image's whole rectangle counts, its edge included: a position is out only past it.
  assert.match(rays, /if\(any\(px<vec2f\(0\.0\)\)\|\|any\(px>size\)\)\{return out;\}/)
  assert.match(rays, /fn spHistoryLighting\(P:vec3f,N:vec3f,depth:f32,pixel:vec2u,t:vec2u\)->vec4f/)
  assert.match(
    rays,
    /let share=unpack2x16float\(pack2x16float\(vec2f\(light\/max\(sums\[0\],1e-4\),0\.0\)\)\)\.x;\s*pdf\*=share\*f32\(SP_RAYS\);/,
  )
})

test('the screen trace casts no ray from a pixel with backface diffuse light toward its backface, ends a ray toward the eye at a hundredth of its origin’s view depth under either projection, and puts the hit where the ray crossed', () => {
  const trace = code('traceScreen')
  assert.match(
    trace,
    /if\(\(probe\.foliage&&dot\(probe\.N,d\)<0\.0\)\|\|\(probe\.hair&&spFlag\(SP_FLAG_SKIP_HAIR_HITS\)\)\)\{return aimed;\}/,
    'the backface ray of a pixel with backface diffuse light is not traced, nor any ray of hair where its hits are skipped (the begin of the screen stage, which both the hierarchical walk and the fixed-step cast start from)',
  )
  assert.match(trace, /select\(1e30,-0\.99\*A\.w\/toward\.w,toward\.w<0\.0\)/)
  // Under an orthographic projection too: a hundredth of the origin's depth is left, not the way to the near plane.
  assert.match(
    trace,
    /select\(1e30,0\.99\*\(reflectionView\.slab\.y-A\.z\)\/toward\.z,toward\.z>0\.0\)/,
  )
  assert.match(
    trace,
    /let hitPoint=worldAt\(H\.xy,H\.z\);/,
    'the ray’s depth at the crossing, not the tile’s',
  )
  assert.doesNotMatch(trace, /marched\.plane\.yz/)
})

test('a missed ray ends where the march stopped, two centimetres on, and a hit near the image’s edge reads a clamped texel', () => {
  const trace = code('traceScreen')
  assert.match(trace, /let stop=select\(marched\.t,marched\.above,marched\.t<0\.0\);/)
  assert.match(
    trace,
    /seen\.distance=min\(distance\(origin\+d\*\(span\*along\),probe\.P\)\+SP_CLEAN_MISS_OFFSET,spMaxTrace\(\)\);/,
  )
  assert.match(trace, /const SP_CLEAN_MISS_OFFSET:f32=0\.02;/)
  assert.match(
    trace,
    /let texel=clamp\(vec2i\(floor\(ndcToPixel\(motion\.ndc,reflectionView\.radiance\.xy\)\)\),vec2i\(0\),last\);/,
  )
  // No hit is refused for its texel leaving the image: the texel is clamped instead.
  assert.doesNotMatch(trace, /let inside=all\(texel/)
})

test('the noise of a ray is drawn at its texel of the traces’ atlas, and the light of a hit is dithered by it into the trace’s word', () => {
  const trace = code('traceScreen')
  assert.match(
    trace,
    /let noise=interleavedGradientNoise\(vec2f\(at\)\+vec2f\(0\.5\),f32\(sp\.frames\.x%SP_TILE_JITTERS\)\);/,
  )
  assert.match(trace, /packLight\(ditherLight\(seen\.radiance,noise\)\)/)
})

test('the composite writes the dithered light, the code of the nearest hit, and each texel’s moving weight as a byte, a probe’s the mean of its bytes', () => {
  const composite = code('composite')
  assert.match(
    composite,
    /atomicAdd\(&accumulated\[base\+5u\],select\(0u,u32\(weight\*share\),spHitMoves\(hitWord\)\)\);/,
  )
  assert.match(composite, /out=vec4f\(spQuantize\(light,e\),spHitCode\(nearest\)\);/)
  assert.match(
    composite,
    /var out=vec4f\(0\.0,0\.0,0\.0,255\.0\);/,
    'a probe on no lit surface: no light, the greatest distance',
  )
  assert.match(
    composite,
    /probeMoving\[index\]=select\(0\.0,select\(round\(f32\(atomicLoad\(&movingBytes\)\)\/f32\(SP_TEXELS\)\)\/255\.0,1\.0,spFlag\(SP_FLAG_FORCE_MOVING\)\),valid\);/,
  )
})

test('each pass of the spatial filter dithers its light by the blue noise of its own rank, and reads the hits as codes', () => {
  const spatial = code('spatial')
  assert.match(spatial, /var<uniform> spatialPass:vec4u;/)
  assert.match(
    spatial,
    /let dither=blueNoiseScalar\(id\.xy,sp\.size\.w%SP_TILE_JITTERS\+spatialPass\.x\+11u\);/,
  )
  assert.match(
    spatial,
    /spQuantize\(select\(vec3f\(0\.0\),total\.rgb\/total\.w,total\.w>0\.0\),dither\)/,
  )
  assert.match(spatial, /let keptHit=spHitFromCode\(kept\.w\);/)
  assert.match(spatial, /let ownHit=spHitFromCode\(own\.w\);/)
})

test('the irradiance is written as an 11-11-10 target holds it, dithered by a hash of its texel and the frame', () => {
  const convert = code('convert')
  assert.match(convert, /spQuantize\(spIrradianceAt\(n\),spTargetDither\(at,0\)\)/)
  assert.match(convert, /spQuantize\(coefficients\[k\],spTargetDither\(atlas,0\)\)/)
})

test('the octahedral irradiance is the harmonics evaluated as they are, never clamped, at the filter and at the pixel; the harmonics’ own evaluation at the pixel stays held to zero', () => {
  const convert = code('convert')
  const from = convert.indexOf('fn spIrradianceAt(')
  const at = convert.slice(from, convert.indexOf('@compute', from))
  assert.match(at, /^fn spIrradianceAt\(n:vec3f\)->vec3f\{\n return coefficients\[0u\]/)
  assert.doesNotMatch(at, /max\(/)
  const picked = Object.values(sources)
    .map((kernel) => kernel!.code)
    .find((text) => text.includes('fn spPickedIrradiance('))!
  const body = picked.slice(picked.indexOf('fn spPickedIrradiance('))
  assert.match(
    body,
    // Under the occlusion, never clamped.
    /irradiance\+=spOctahedralIrradiance\(places\[corner\],N\)\*picked\.weights\[corner\];\}\n  \}\n  return irradiance\*ao;/,
  )
  assert.match(body, /return max\(coefficients\[0u\]/)
})

test('a light kept at more precision (lightingDataFormat other than r11g11b10) is not rounded to the 11-11-10 mantissas', () => {
  const run = shaderRun<{ spQuantize: (c: number[], e: number) => number[] }>(
    wgslModule(SP_QUANTIZE),
    ['spQuantize'],
    { spFlag: () => true, SP_FLAG_EXACT_LIGHT: 0 },
  )
  const light = [1 + 0.3 / 64, -0.5, 7.123]
  assert.deepEqual(run.spQuantize(light, 0.5), light)
})

test('a negative irradiance is held to zero by the 11-11-10 target that stores it', () => {
  const run = shaderRun<{ spQuantize: (c: number[], e: number) => number[] }>(
    wgslModule(SP_QUANTIZE),
    ['spQuantize'],
    { spFlag: () => false, SP_FLAG_EXACT_LIGHT: 0 },
  )
  assert.deepEqual(run.spQuantize([-0.5, 2, -1], 0.5), [0, 2, 0])
})

test('a pixel that is no lit surface holds no visibility and the direction (0, 0, 1) at full length', () => {
  const occlusion = code('occlusion')
  assert.match(occlusion, /var visibility=0\.0;\s*var stored=vec3f\(0\.0,0\.0,1\.0\);/)
  assert.match(
    occlusion,
    /stored=select\(s\.N,normalize\(bent\),dot\(bent,bent\)>1e-12\)\*visibility;/,
  )
})
