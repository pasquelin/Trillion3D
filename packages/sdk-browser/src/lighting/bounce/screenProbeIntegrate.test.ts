// The screen probes' integration of the pixels: which tiles run the rough specular, the classification of the tiles, the diffuse method and the light at the back of a thin sheet.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { SP_DIFFUSE_METHOD, SP_ROUGH_LERP } from './screen/integrateWgsl.ts'
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
