// The screen probes' integration of the pixels: the diffuse light of a pixel that samples its BRDF, the numerical integral, the bounces off occluders, the rough specular's lobe and the answer of the radiance cache.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { integrateShader } from './screen/integratePassWgsl.ts'
import { spCacheRead } from './screen/cacheReadWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'

const ultra = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })), undefined, undefined, undefined, undefined, false)

test('the diffuse light of a pixel that samples its BRDF is the mean of eight cosine-weighted directions over the probes times pi: a sky of radiance one gives pi, every direction lies in the normal’s hemisphere, and hair draws the whole sphere', () => {
  const code = integrateShader(1, 1, 1, [4, 2], false, false, 1, true)
  const run = (sphere: boolean, N: number[]) => {
    const seen: number[][] = []
    const sampled = shaderRun<{
      spSampledDiffuse: (picked: object, pixel: number[], N: number[], sphere: boolean) => number[]
    }>(code, ['spSampledDiffuse'], {
      spProbeLight: (_picked: object, direction: number[], level: number) => {
        seen.push(direction)
        assert.equal(level, 0, 'the coarsest level of a gather of one')
        return [1, 1, 1]
      },
      spSampleSeed: () => [0, 0],
      // Eight points of the unit square, and a map of the square to a disc of radius 0.7.
      hammersley16: (index: number) => [(index + 0.5) / 8, ((index * 3) % 8) / 8 + 1 / 16],
      uniformDiskConcentric: (e: number[]) => e.map((x) => (x - 0.5) * 1.4),
    }).spSampledDiffuse({ atlas: [], weights: [1, 0, 0, 0], valid: true }, [0, 0], N, sphere)
    return { light: sampled, seen }
  }
  const hemisphere = run(false, [0, 0.6, 0.8])
  assert.equal(hemisphere.seen.length, 8)
  nearRelative(hemisphere.light[0], Math.PI, 'a sky of radiance one: the irradiance', 1e-6)
  for (const direction of hemisphere.seen) {
    nearRelative(Math.hypot(...direction), 1, 'a unit direction', 1e-5)
    assert.ok(direction[1] * 0.6 + direction[2] * 0.8 > 0, 'in the hemisphere of the normal')
  }
  const sphere = run(true, [0, 0.6, 0.8])
  nearRelative(sphere.light[0], Math.PI, 'the same sum over the sphere', 1e-6)
  assert.ok(
    sphere.seen.some((direction) => direction[1] * 0.6 + direction[2] * 0.8 < 0),
    'hair draws the whole sphere',
  )
})

test('the numerical integral of the diffuse light sums the cosine of every texel of the octahedron that lies in the hemisphere over two pi of their count, the texels of the equal-area map at their centres: a sky of radiance one gives 9 pi / 8 for a normal along the map’s axis at sixteen texels a side, and the back counted too, 63 pi / 128', () => {
  const code = screenProbeSources(
    kernelShapeOf(
      screenProbeSettings({ screenProbes: 'ultra', screenProbeDiffuseIntegralMethod: 2 }),
    ), undefined, undefined, undefined, undefined, false,
).integrateEvery!.code
  const light = (backface: boolean) =>
    shaderRun<{ spNumericalDiffuse: (picked: object, s: object) => number[] }>(
      code,
      ['spNumericalDiffuse'],
      {
        sp: { counts: [0, 0, 0, 16] },
        probeGather: {},
        textureLoad: () => [1, 1, 1, 1],
      },
    ).spNumericalDiffuse(
      {
        atlas: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        weights: [1, 0, 0, 0],
        valid: true,
      },
      { N: [0, 0, 1], backface },
    )[0]
  // The centres of the texels lie at |e.x|, |e.y| odd sixteenths; one at the pole has cosine 1 - (|e.x| + |e.y|)², the ones on the hemisphere’s edge (|e.x| + |e.y| = 1) none and
  // counted by none. 28 texels by quadrant lie inside, their cosines summing to 28 - 3136 / 256 = 15.75: 63 over the 112 texels counted, which is 0.5625 of mean cosine and not the
  // continuous half, the discretisation of the sum itself. Two pi over the count gives 63 * 2 pi / 112 = 9 pi / 8; with the back counted, the 256 texels: 63 * 2 pi / 256.
  nearRelative(light(false), (9 * Math.PI) / 8, 'the hemisphere’s texels', 1e-6)
  nearRelative(light(true), (63 * Math.PI) / 128, 'every texel counted', 1e-6)
})

test('the diffuse light the probes give a pixel under an occlusion is rescaled by the bounces off occluders of its own albedo: a black albedo keeps the first bounce’s share alone, a bright one gets more, a shut sky none', () => {
  const rescale = shaderRun<{
    distantIlluminationRescale: (albedo: number[], ao: number) => number[]
  }>(
    integrateShader(1, 1, 1, [4, 2], false, false, 1, true),
    ['distantIlluminationRescale'],
    {},
  ).distantIlluminationRescale
  // A black albedo has the first bounce alone: ao (1 + (1 - ao) / (2 (1 - ao)^¼)), the occlusion held under 0.999.
  nearRelative(
    rescale([0, 0, 0], 0.999)[0],
    0.999 * (1 + 0.001 / (2 * 0.001 ** 0.25)),
    'open',
    1e-5,
  )
  const ao = 0.5
  nearRelative(
    rescale([0, 0, 0], ao)[0],
    ao * (1 + (1 - ao) / (2 * (1 - ao) ** 0.25)),
    'black',
    1e-5,
  )
  // A bright albedo gives more light back than a dark one under the same occlusion.
  assert.ok(rescale([0.8, 0.8, 0.8], ao)[0] > rescale([0.1, 0.1, 0.1], ao)[0])
  assert.equal(rescale([0.5, 0.5, 0.5], 0)[0], 0, 'a shut sky: none')
})

test('the rough specular samples the base layer’s lobe: the surface’s own normal, wider along the axis of an anisotropy than across it', () => {
  const { integrate } = ultra
  assert.ok(integrate)
  const code = integrate.code
  // The normal the surface buffer keeps is the base layer’s: the coat’s own is a separate field of the lobes target, which is not read.
  assert.match(code, /var frame=frameAround\(s\.N\);/)
  assert.doesNotMatch(code, /coatN/)
  assert.match(code, /let axis=packedLobeAxis\(texel,s\.N,alpha\);/)
  assert.match(code, /widths=vec2f\(axis\.w,packedLobeAcross\(texel,alpha\)\);/)
  assert.match(code, /frame=Frame3\(axis\.xyz,cross\(s\.N,axis\.xyz\),s\.N\);/)
  assert.match(code, /visibleGgxHalf\(e,widths,v\)/)
  // A cloth’s texel holds no axis, and a pixel without lobes keeps the round lobe.
  assert.match(code, /if\(!lobeIsCloth\(texel\)\)/)
  assert.match(code, /if\(lobed\)\{/)
})

test('a ray the radiance cache answers keeps the distance it reads, but the furthest a ray looks in its word where every probe’s ray met no surface', () => {
  const farOf = (covers: boolean, distance: number) =>
    shaderRun<{
      spFarOf: (
        P: number[],
        d: number[],
        size: number,
      ) => { radiance: number[]; distance: number; stored: number }
    }>(
      wgslModule(bounceBindingsWgsl(0, 0, 1), spCommon([4, 2]), spCacheRead(2, 3, 4, 'private')),
      ['spFarOf'],
      {
        spFlag: () => true,
        spCacheCovers: () => covers,
        spCacheSample: () => ({ radiance: [1, 2, 3], distance, sky: 0 }),
        spMaxTrace: () => 200,
        reflectionEnvironment: () => [7, 8, 9],
      },
    ).spFarOf([0, 0, 0], [0, 0, 1], 8)
  const greatest = farOf(true, 655.03)
  assert.deepEqual(greatest.radiance, [1, 2, 3])
  assert.deepEqual([greatest.distance, greatest.stored], [655.03, 200])
  // The sum of the eight shares may fall a rounding short of the greatest distance: the probes' rays still met nothing.
  assert.equal(farOf(true, 655.03 * (1 - 1e-7)).stored, 200)
  // One probe's ray met a surface: the blend is kept as it is, even past the furthest a ray looks.
  assert.deepEqual([farOf(true, 400).distance, farOf(true, 400).stored], [400, 400])
  assert.deepEqual(farOf(false, 655.03), { radiance: [7, 8, 9], distance: 200, stored: 200 })
})

test('the temporal filter of the probes blends the last image’s probes on the same plane at the same texel by the setting’s weight, dithers the result as the reference does, and leaves the radiance alone without a history', () => {
  const all = screenProbeSources(
    kernelShapeOf(
      screenProbeSettings({ screenProbes: 'ultra', screenProbeTemporalFilterProbes: true }),
    ), undefined, undefined, undefined, undefined, false,
)
  const code = all.probeFilter!.code
  assert.match(code, /if\(any\(px<vec2f\(0\.0\)\)\|\|any\(px>size\)\)\{return vec4f\(0\.0\);\}/)
  assert.match(code, /if\(exp2\(SP_FILTER_PLANE_SCALE\*away\*away\)>SP_FILTER_MIN_WEIGHT\)\{/)
  assert.match(code, /const SP_FILTER_PLANE_SCALE:f32=-10000;/)
  assert.match(code, /const SP_FILTER_MIN_WEIGHT:f32=0\.1;/)
  assert.match(code, /var out=fresh;\n if\(probe\.depth>0\.0&&spFlag\(SP_FLAG_PROBE_TEMPORAL\)\)\{/)
  assert.match(code, /mix\(fresh\.rgb,kept\.rgb,select\(0\.0,sp\.screen\.y,kept\.w>0\.0\)\)/)
  assert.match(code, /let dither=spTargetDither\(id\.xy,10\);/)
  assert.match(code, /out=vec4f\(spQuantize\(mixed,dither\),fresh\.w\);/)
  // The composite goes into the history of this turn, which the filter reads beside the last turn’s; the spatial passes start from the filtered texture.
  assert.doesNotMatch(all.composite!.code, /aoOut/)
})

test('a pixel with backface diffuse light is told apart by what its material is, not by whether the level gathers that light: its depth weights, pdf lobe, history and rays follow `foliage`, only the backface light follows `backface`', () => {
  const high = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'high' })), undefined, undefined, undefined, undefined, false)
  for (const [name, source] of Object.entries(high)) {
    if (!['place', 'screenData', 'integrate', 'temporal', 'traceScreen'].includes(name)) continue
    const uses = [...source.code.matchAll(/\b(\w+)\.backface\b/g)].map((m) => m[0])
    const allowed = name === 'integrate' ? ['s.backface'] : []
    assert.deepEqual(
      [...new Set(uses)],
      allowed,
      `${name} reads the gather switch only for the light`,
    )
  }
  assert.match(
    high.place!.code,
    /spInterpolation\(pix,vec2f\(0\.0\),s\.P,s\.N,spDepthOf\(s\.P\),s\.foliage\)/,
  )
  assert.match(high.place!.code, /spAdaptiveWeight\(pix,s\.P,s\.N,depth,s\.foliage,other/)
  assert.match(high.integrate!.code, /spInterpolation\(pixel,offset,s\.P,s\.N,depth,s\.foliage\)/)
  assert.match(high.screenData!.code, /spPdfLobe\(s\.N,s\.hair\|\|s\.foliage\)/)
  assert.match(high.screenData!.code, /spReproject\(pixel,s\.P,s\.N,s\.foliage,/)
  assert.match(high.temporal!.code, /spReproject\(id\.xy,s\.P,s\.N,s\.foliage,noise\)/)
  assert.match(high.integrate!.code, /spIntegrate\(pixel,cell,s,mode,s\.backface,/)
  assert.match(high.traceScreen!.code, /probe\.foliage&&dot\(probe\.N,d\)<0\.0/)
})
