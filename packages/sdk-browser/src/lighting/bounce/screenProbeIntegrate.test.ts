// The screen probes' integration of the pixels: which tiles run the rough specular, the lobe it samples, the temporal filter of the probes, and the answer of the radiance cache to a ray that met no surface.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { SP_DIFFUSE_METHOD, SP_ROUGH_LERP } from './screen/integrateWgsl.ts'
import { integrateShader } from './screen/integratePassWgsl.ts'
import { spCacheRead } from './screen/cacheReadWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'
import {
  INTEGRATE_TILE_ARGS_WORDS,
  INTEGRATE_TILE_SIDE,
  integrateArgsAt,
  integrateTiles,
} from './screen/screenProbeLayout.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'

const ultra = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })))

test('a pixel keeps its rough specular where the traced rays do not give its reflection whole, or a clear coat or an anisotropy leaves its base lobe untraced, and takes the diffuse light over pi elsewhere', () => {
  const run = shaderRun<{
    spRoughLerp: (roughness: number, foliage: boolean, lobed: boolean) => number
    spLobed: (flags: number) => boolean
  }>(wgslModule(SP_ROUGH_LERP), ['spRoughLerp', 'spLobed'], {
    // The rays are traced to a roughness of 0.5 (0.3 for a thin sheet) and fade out over a tenth under it; the rough specular is read past 0.8 (0.4 for a thin sheet).
    reflectionView: { lobe: [0.5, 0.1, 0, 0], reach: [0, 0, 0.3, 0] },
    sp: { trace: [0, 0, 0.8, 0.4] },
  })
  assert.equal(
    run.spRoughLerp(0.2, false, false),
    1,
    'a reflection traced whole: the diffuse light',
  )
  assert.equal(run.spRoughLerp(0.2, false, true), 0, 'a coat or an anisotropy: the lobe is sampled')
  assert.ok(
    Math.abs(run.spRoughLerp(0.7, false, false) - 0.5) < 1e-9,
    'past the traced rays, half way over the band',
  )
  assert.equal(
    run.spRoughLerp(0.7, true, false),
    1,
    'a thin sheet reaches the diffuse light sooner',
  )
  assert.ok(
    Math.abs(run.spRoughLerp(0.3, true, false) - 0.5) < 1e-9,
    'a thin sheet is traced whole only under its own bar, 0.3: past it the band of its rough specular',
  )
  assert.equal(run.spLobed(PHYSICAL_SURFACE_FLAG), true)
  assert.equal(run.spLobed(0), false)
})

test('the integration is classified by tile in three modes: the tiles of a mode are listed and counted for an indirect dispatch each, a tile without a lit pixel is cleared and listed nowhere', () => {
  const { tile, integrate } = ultra
  assert.ok(tile && integrate, 'a level that casts classifies and integrates its tiles')
  assert.equal(ultra.integrateEvery, undefined, 'and does not integrate every pixel at once')
  assert.deepEqual(tile.points, ['tileInit', 'tileClassify', 'tileFinish'])
  assert.deepEqual(integrate.points, ['integrateSimple', 'integrateSampled', 'integrateComplete'])
  // The workgroups of the three modes are emptied to (0, 1, 1) each and the counts to zero; a tile adds one to the count of the most complete mode its pixels need
  // and is listed one past its coordinates, so that an empty entry is zero; the finish turns a count into rows of at most 65535 workgroups.
  assert.match(tile.code, /const SP_COUNTS_AT:u32=9u;/)
  assert.match(tile.code, /select\(0u,1u,word<SP_COUNTS_AT&&word%3u!=0u\)/)
  assert.match(
    tile.code,
    /let mode=select\(select\(SP_TILE_SIMPLE,SP_TILE_SAMPLED,\(modes&SP_TILE_BIT_SAMPLED\)!=0u\),SP_TILE_COMPLETE,\(modes&SP_TILE_BIT_COMPLETE\)!=0u\);/,
  )
  assert.match(tile.code, /let place=atomicAdd\(&tileArgs\[SP_COUNTS_AT\+mode\],1u\);/)
  assert.match(tile.code, /tileList\[mode\*spTileCount\(\)\+place\]=group\.x\|\(group\.y<<16u\);/)
  assert.match(tile.code, /for\(var mode=0u;mode<3u;mode\+\+\)\{/)
  assert.match(tile.code, /atomicStore\(&tileArgs\[mode\*3u\],min\(tiles,SP_TILE_ROW\)\);/)
  assert.match(
    tile.code,
    /atomicStore\(&tileArgs\[mode\*3u\+1u\],max\(\(tiles\+SP_TILE_ROW-1u\)\/SP_TILE_ROW,1u\)\);/,
  )
  assert.match(tile.code, /const SP_TILE_ROW:u32=65535u;/)
  assert.match(tile.code, /atomicOr\(&tileModes,spTileBitOf\(s\.hair,rough\)\)/)
  assert.match(tile.code, /if\(modes==0u\)\{\n  if\(inside\)\{\n   textureStore\(lightOut/)
  for (const [mode, point] of integrate.points.entries())
    assert.match(
      integrate.code,
      new RegExp(`fn ${point}\\(.*\\)\\{\\n spIntegrateTile\\(group,local\\.xy,${mode}u\\);`),
    )
  assert.match(integrate.code, /let index=group\.y\*SP_TILE_ROW\+group\.x;\n if\(index>=tileCounts/)
  assert.match(integrate.code, /if\(index>=tileCounts\[9u\+mode\]\)\{return;\}/)
  assert.match(integrate.code, /let tile=tileList\[mode\*spTileCount\(\)\+index\];/)
  assert.equal(INTEGRATE_TILE_SIDE, 8)
  assert.equal(INTEGRATE_TILE_ARGS_WORDS, 12, 'three modes, three words each, then their counts')
  assert.deepEqual(
    [0, 1, 2].map(integrateArgsAt),
    [0, 12, 24],
    'the bytes of each mode’s workgroups',
  )
  assert.equal(integrateTiles({ width: 1400, height: 788 }), 175 * 99)
  for (const [name, source] of Object.entries({ tile, integrate }))
    assertProgramAssembles(source.code, undefined, name)
})

test('a pixel needs the mode of the reference’s classification: the complete one for hair, the sampled one for a pixel that samples its BRDF or has a rough specular to sample, the simple one else; hair always samples its BRDF', () => {
  const method = (integral: number) =>
    shaderRun<{
      spTileBitOf: (hair: boolean, roughLerp: number) => number
      spDiffuseMethod: (hair: boolean) => number
    }>(wgslModule(SP_DIFFUSE_METHOD), ['spTileBitOf', 'spDiffuseMethod'], {
      SP_INTEGRAL_METHOD: integral,
    })
  const [SIMPLE, SAMPLED, COMPLETE] = [1, 2, 4]
  const preintegrated = method(0)
  assert.equal(preintegrated.spTileBitOf(false, 1), SIMPLE, 'nothing to sample')
  assert.equal(preintegrated.spTileBitOf(false, 0.5), SAMPLED, 'a rough specular to sample')
  assert.equal(preintegrated.spTileBitOf(false, 0), SAMPLED)
  assert.equal(preintegrated.spTileBitOf(true, 1), COMPLETE, 'hair, whatever its roughness')
  assert.equal(preintegrated.spTileBitOf(true, 0.2), COMPLETE)
  assert.equal(method(1).spTileBitOf(false, 1), SAMPLED, 'the method asks the BRDF sampled')
  assert.equal(method(1).spTileBitOf(true, 1), COMPLETE)
  assert.deepEqual(
    [0, 1, 2].map((integral) =>
      [false, true].map((hair) => method(integral).spDiffuseMethod(hair)),
    ),
    [
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    'the method asked, but for hair, which samples its BRDF',
  )
  // The classification marks a pixel with a bit and ors them over the tile: the most complete mode wins.
  assert.match(ultra.tile!.code, /const SP_INTEGRAL_METHOD:u32=0u;/)
})

test('a simple tile takes the diffuse light over pi for its rough specular and samples nothing, a sampled or complete one the lobe; hair of a complete tile is drawn over the sphere', () => {
  const { integrate } = ultra
  assert.ok(integrate)
  assert.match(
    integrate.code,
    /if\(mode==SP_TILE_SIMPLE\)\{out\.rough=spPacked\(diffuse\*INVERSE_PI,e\);\}/,
  )
  assert.match(
    integrate.code,
    /else\{out\.rough=spPacked\(spRoughSpecular\(pixel,s,picked,diffuse,vec4f\(sky\.xyz,ao\),s\.hair&&mode>=SP_TILE_COMPLETE\),e\);\}/,
  )
  assert.match(
    integrate.code,
    /var L=sampleSphereEven\(e\);\n  if\(!sphere\)\{\n   let H=outOfFrame\(visibleGgxHalf\(e,widths,v\),frame\);\n   L=2\.0\*dot\(V,H\)\*H-V;/,
  )
})

test('the diffuse method picks the irradiance of the probes, the pixel’s BRDF sampled over their coarsest radiance (not in a simple tile), or, over every pixel at once, the numerical integral, each put under the occlusion as the reference puts it', () => {
  const { integrate } = ultra
  assert.ok(integrate)
  const code = integrate.code
  assert.match(
    code,
    /if\(method==SP_METHOD_PREINTEGRATED\)\{\n  light=spPickedIrradiance\(picked,lit,ao\);/,
  )
  assert.match(
    code,
    /\}else if\(method==SP_METHOD_SAMPLED&&mode!=SP_TILE_SIMPLE\)\{\n  light=spSampledDiffuse\(picked,pixel,s\.N,s\.hair&&mode>=SP_TILE_COMPLETE\)\*distantIlluminationRescale\(albedo,ao\);/,
  )
  assert.doesNotMatch(
    code,
    /spNumericalDiffuse/,
    'the numerical integral is only where it is asked',
  )
  // The material's occlusion goes over the light of every method.
  assert.match(code, /\n if\(spFlag\(SP_FLAG_MATERIAL_AO\)\)\{light\*=/)
  const numerical = screenProbeSources(
    kernelShapeOf(
      screenProbeSettings({ screenProbes: 'ultra', screenProbeDiffuseIntegralMethod: 2 }),
    ),
  )
  assert.equal(numerical.tile, undefined, 'the numerical integral has no classification of tiles')
  assert.equal(numerical.integrate, undefined)
  assert.deepEqual(numerical.integrateEvery!.points, ['integrateEvery'])
  assert.match(numerical.integrateEvery!.code, /const SP_INTEGRAL_METHOD:u32=2u;/)
  assert.match(
    numerical.integrateEvery!.code,
    /else if\(method==SP_METHOD_NUMERICAL&&mode==SP_TILE_EVERY\)\{\n  light=spNumericalDiffuse\(picked,s\)\*distantIlluminationRescale\(albedo,ao\);/,
  )
  assert.match(numerical.integrateEvery!.code, /spIntegrateCell\(id\.xy,SP_TILE_EVERY\);/)
  assertProgramAssembles(numerical.integrateEvery!.code, undefined, 'integrateEvery')
  const flat = screenProbeSources(
    kernelShapeOf(
      screenProbeSettings({
        screenProbes: 'ultra',
        screenProbeIntegrationTileClassification: false,
      }),
    ),
  )
  assert.equal(flat.tile, undefined)
  assert.doesNotMatch(flat.integrateEvery!.code, /tileList|tileCounts/)
  assert.doesNotMatch(flat.integrateEvery!.code, /spNumericalDiffuse/)
  assertProgramAssembles(flat.integrateEvery!.code, undefined, 'integrateEvery')
  // The tiles' bindings are the layout's only where the tiles are classified.
  assert.ok(integrate.entries.length - flat.integrateEvery!.entries.length === 2)
  const sampled = screenProbeSources(
    kernelShapeOf(
      screenProbeSettings({ screenProbes: 'ultra', screenProbeDiffuseIntegralMethod: 1 }),
    ),
  )
  assert.match(sampled.tile!.code, /const SP_INTEGRAL_METHOD:u32=1u;/)
  assertProgramAssembles(sampled.integrate!.code, undefined, 'integrate')
})

test('the light at the back of a thin sheet is the probes’ irradiance behind it whatever the diffuse method: the reference’s sampled branch leaves it zero', () => {
  // The reference accumulates the back light in its preintegrated branch and its numerical one, never in the one that samples the BRDF: a sheet of foliage lit through
  // its back would lose it there. Here it is taken after the method, for every method and every mode.
  for (const screenProbeDiffuseIntegralMethod of [0, 1, 2]) {
    const sources = screenProbeSources(
      kernelShapeOf(
        screenProbeSettings({ screenProbes: 'ultra', screenProbeDiffuseIntegralMethod }),
      ),
    )
    const code = (sources.integrate ?? sources.integrateEvery)!.code
    assert.match(
      code,
      /\n if\(withBack\)\{out\.back=spPacked\(spPickedIrradiance\(picked,-s\.N,1\.0\),e\);\}/,
      `method ${screenProbeDiffuseIntegralMethod}`,
    )
  }
})

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
    ),
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
    ),
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
  const high = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'high' })))
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
