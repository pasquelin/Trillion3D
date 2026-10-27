// The screen probes' integration of the pixels: which tiles run the rough specular, the lobe it samples, the temporal filter of the probes, and the answer of the radiance cache to a ray that met no surface.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { SP_ROUGH_LERP } from './screen/integrateWgsl.ts'
import { spCacheRead } from './screen/cacheReadWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'
import {
  INTEGRATE_TILE_ARGS_WORDS,
  INTEGRATE_TILE_SIDE,
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

test('the integration is classified by tile: the tiles of a mode are listed and counted for an indirect dispatch each, a tile without a lit pixel is cleared and listed nowhere', () => {
  const { tile, integrate } = ultra
  assert.ok(tile && integrate, 'a level that casts classifies and integrates its tiles')
  assert.deepEqual(tile.points, ['tileInit', 'tileClassify', 'tileFinish'])
  assert.deepEqual(integrate.points, ['integrate', 'integrateSimple'])
  // The workgroups of the two modes are emptied to (0, 1, 1) each and the counts to zero; a tile adds one to the count of the mode of its fullest pixel
  // and is listed one past its coordinates, so that an empty entry is zero; the finish turns a count into rows of at most 65535 workgroups.
  assert.match(tile.code, /select\(0u,1u,word<6u&&word%3u!=0u\)/)
  assert.match(tile.code, /let mode=select\(1u,0u,\(modes&SP_TILE_FULL\)!=0u\);/)
  assert.match(tile.code, /let place=atomicAdd\(&tileArgs\[6u\+mode\],1u\);/)
  assert.match(tile.code, /tileList\[mode\*spTileCount\(\)\+place\]=group\.x\|\(group\.y<<16u\);/)
  assert.match(tile.code, /atomicStore\(&tileArgs\[mode\*3u\],min\(tiles,SP_TILE_ROW\)\);/)
  assert.match(
    tile.code,
    /atomicStore\(&tileArgs\[mode\*3u\+1u\],max\(\(tiles\+SP_TILE_ROW-1u\)\/SP_TILE_ROW,1u\)\);/,
  )
  assert.match(tile.code, /const SP_TILE_ROW:u32=65535u;/)
  assert.match(tile.code, /atomicOr\(&tileModes,select\(SP_TILE_SIMPLE,SP_TILE_FULL,rough<1\.0\)\)/)
  assert.match(tile.code, /if\(modes==0u\)\{\n  if\(inside\)\{\n   textureStore\(lightOut/)
  assert.match(integrate.code, /spIntegrateTile\(group,local\.xy,false\)/)
  assert.match(integrate.code, /spIntegrateTile\(group,local\.xy,true\)/)
  assert.match(integrate.code, /let index=group\.y\*SP_TILE_ROW\+group\.x;\n if\(index>=tileCounts/)
  assert.match(integrate.code, /if\(index>=tileCounts\[select\(6u,7u,simple\)\]\)\{return;\}/)
  assert.equal(INTEGRATE_TILE_SIDE, 8)
  assert.equal(INTEGRATE_TILE_ARGS_WORDS, 8, 'two modes, three words each, then their counts')
  assert.equal(integrateTiles({ width: 1400, height: 788 }), 175 * 99)
  for (const [name, source] of Object.entries({ tile, integrate }))
    assertProgramAssembles(source.code, undefined, name)
})

test('a simple tile takes the diffuse light over pi for its rough specular and samples nothing, a full one the lobe', () => {
  const { integrate } = ultra
  assert.ok(integrate)
  assert.match(integrate.code, /if\(simple\)\{out\.rough=spPacked\(diffuse\*INVERSE_PI,e\);\}/)
  assert.match(
    integrate.code,
    /else\{out\.rough=spPacked\(spRoughSpecular\(pixel,s,picked,diffuse,vec4f\(sky\.xyz,ao\)\),e\);\}/,
  )
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
  assert.match(high.integrate!.code, /spIntegrate\(pixel,cell,s,simple,s\.backface,/)
  assert.match(high.traceScreen!.code, /probe\.foliage&&dot\(probe\.N,d\)<0\.0/)
})
