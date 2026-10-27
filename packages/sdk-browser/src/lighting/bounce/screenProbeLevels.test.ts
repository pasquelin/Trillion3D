// The screen probes' extra ambient occlusion and the levels of the gathered radiance.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { INTEGRATE_BINDINGS, integrateEntries } from './screen/integratePassWgsl.ts'
import { kernelShapeOf, mipLevelOf, screenProbeSources } from './screen/kernels.ts'
import { gatherMipSide } from './screen/screenProbeLayout.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { reflectionLayout } from '../reflections/reflectionPipelines.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'

const ultra = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })))

test('the extra ambient occlusion, the temporal filter of the probes and the levels of the gather exist only where asked, and every kernel assembles with all three', () => {
  const plain = Object.keys(ultra)
  for (const name of ['probeFilter', 'fixup', 'mip1']) assert.ok(!plain.includes(name), name)
  assert.doesNotMatch(ultra.composite!.code, /aoOut/)
  assert.doesNotMatch(ultra.integrate!.code, /extraAoMap|SP_MIP_LEVELS/)
  const all = screenProbeSources(
    kernelShapeOf(
      screenProbeSettings({
        screenProbes: 'ultra',
        screenProbeTemporalFilterProbes: true,
        screenProbeExtraAmbientOcclusion: true,
        screenProbeGatherNumMips: 2,
      }),
    ),
  )
  for (const name of ['probeFilter', 'fixup', 'mip1'])
    assert.ok(Object.keys(all).includes(name), name)
  for (const [name, source] of Object.entries(all)) {
    assertProgramAssembles(source.code, undefined, name)
    const declared = [...source.code.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map((m) => +m[1])
    const bound = source.entries.map((entry) => entry.binding)
    assert.deepEqual(
      bound.filter((binding) => !declared.includes(binding)),
      [],
      `${name}: a binding the layout holds and the code does not declare`,
    )
  }
  assert.match(all.composite!.code, /aoOut/)
  assert.match(all.spatial!.code, /aoIn/)
  assert.match(
    all.convert!.code,
    /textureStore\(irradianceOut,vec2i\(at\),vec4f\(irradiance,spExtraAoCode\(select\(0\.0,total\.x\/total\.y,valid\)\)\)\);/,
    'the occlusion by normal is the alpha of the irradiance',
  )
  assert.doesNotMatch(all.convert!.code, /aoMapOut|extraAoMap/)
  assert.match(
    all.integrate!.code,
    /fn spPickedExtraAo\(picked:SpPicked,N:vec3f\)->f32\{\n var places/,
  )
  assert.match(all.integrate!.code, /fn spRoughLevel\(\)->u32/)
  assert.doesNotMatch(all.integrate!.code, /extraAoMap/)
  assert.match(
    all.integrate!.code,
    /textureLoad\(probeIrradiance,base\+vec2i\(1,1\),0\)\.a\/255\.0;\n return bilinear1\(a,b,c,e,p-floor\(p\)\);/,
    'the occlusion is read from the irradiance’s alpha',
  )
  assert.match(
    all.integrate!.code,
    /fn spCoefficientTexel\(atlas:vec2u,k:u32\)->vec2i\{\n let border=8u;/,
    'the harmonics lie in the block of the octahedral map where the occlusion shares the texture',
  )
  assert.match(
    ultra.integrate!.code,
    /fn spCoefficientTexel\(atlas:vec2u,k:u32\)->vec2i\{return vec2i\(vec2u\(atlas\.x\*9u\+k,atlas\.y\)\);\}/,
    'a row of nine texels a probe without it',
  )
  assert.match(
    all.integrate!.code,
    /textureLoad\(probeGather,base\+vec2i\(i32\(i&1u\),i32\(i>>1u\)\),i32\(level\)\)/,
  )
})

test('the extra ambient occlusion of the probes is an occlusion of the diffuse light at the integration: the cone of open sky it leaves cuts the harmonics, its multiple bounces on the albedo follow, and the min() fold into the temporal pass is gone', () => {
  const all = screenProbeSources(
    kernelShapeOf(
      screenProbeSettings({ screenProbes: 'ultra', screenProbeExtraAmbientOcclusion: true }),
    ),
  )
  const code = all.integrate!.code
  const bands = (ao: number) =>
    shaderRun<{ spVisibleBands: (ao: number) => number[] }>(
      code,
      ['spVisibleBands'],
      {},
    ).spVisibleBands(ao)
  const near3 = (actual: number[], expected: number[], label: string) =>
    expected.forEach((v, i) => nearRelative(actual[i], v, label, 1e-5))
  near3(bands(1), [1, 1, 1], 'no occlusion: the whole cosine lobe')
  assert.deepEqual(bands(0), [0, 0, 0], 'shut: nothing')
  // A cone whose cosine is a half: sin² = 3/4, 1 - cos³ = 7/8, sin² (1 + 3 cos²) = 21/16.
  near3(bands(0.75), [0.75, 0.875, 1.3125], 'a cone of cosine a half')
  assert.match(
    code,
    /let ao=min\(sky\.w,spPickedExtraAo\(picked,s\.N\)\);\n(?: \/\/[^\n]*\n)? let lit=normalize\(mix\(sky\.xyz,s\.N,ao\)\);\n let diffuse=spDiffuse\(picked,pixel,s,ao,lit\);/,
    'with the bent normal the diffuse light is read at the normal turned toward it by the occlusion',
  )
  const flat = screenProbeSources(
    kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra', screenProbeBentNormal: false })),
  )
  assert.match(
    flat.integrate!.code,
    /let lit=s\.N;\n let diffuse=spDiffuse\(picked,pixel,s,ao,lit\);/,
  )
  assert.match(code, /if\(ao>0\.0\)\{light\*=bouncedOcclusion\(albedo,ao\)\/ao;\}/)
  assert.match(code, /if\(true\)\{visibility=directionVisibility\(s\.N,sky\.xyz,sky\.w,L\);\}/)
  assert.match(
    ultra.integrate!.code,
    /if\(spFlag\(SP_FLAG_OCCLUSION_IN_INTEGRATION\)\)\{visibility=directionVisibility/,
    'without the extra occlusion the rough specular is weighed only where the occlusion is applied during the integration',
  )
  // The temporal pass blends the occlusion of the search alone.
  assert.doesNotMatch(all.temporal.code, /freshRoughTexel|min\(occlusion\.w/)
})

test('the material’s occlusion and the albedo come from the surfaces’ base colour and emission views by their names, within the sixteen sampled textures of the stage', () => {
  const code = ultra.integrate!.code
  assert.match(code, /let albedo=min\(base\.rgb\*\(1\.0-base\.a\),vec3f\(sp\.foliage\.w\)\);/)
  assert.match(
    code,
    /if\(spFlag\(SP_FLAG_MATERIAL_AO\)\)\{light\*=bouncedOcclusion\(albedo,surfaceEmissiveAo\(at,textureLoad\(sceneFlags,at,0\)\.r\)\.a\);\}/,
  )
  const A = INTEGRATE_BINDINGS.at
  // The stage binds the reflection group beside its own (`reflectionLayout`): the sampled textures of both are the stage's.
  const group = reflectionLayout(fakeDevice().device)
  for (const bentNormal of [false, true]) {
    const entries = integrateEntries(bentNormal)
    const bound = entries.filter((entry) => entry.texture).map((entry) => entry.binding)
    assert.ok(bound.includes(A.base) && bound.includes(A.emissiveAo))
    const sampled = stageBindingCounts({
      bindGroupLayouts: [{ entries }, group] as unknown as GPUBindGroupLayout[],
    }).find(
      ({ limit, kind }) => limit === 'maxSampledTexturesPerShaderStage' && kind.endsWith('Compute'),
    )
    assert.ok(sampled)
    assert.ok(
      sampled.count <= limitOf('maxSampledTexturesPerShaderStage'),
      `${sampled.count} sampled textures of the sixteen a stage holds, the reflection group's included`,
    )
  }
})

test('the gathered radiance with levels holds a border of two texels at its finest level and halves it whole: eight texels a side are twelve, then six', () => {
  assert.deepEqual(
    [0, 1].map((level) => gatherMipSide(8, 2, level)),
    [12, 6],
  )
  assert.deepEqual(
    [0, 1].map((level) => gatherMipSide(16, 2, level)),
    [20, 10],
  )
  assert.equal(gatherMipSide(8, 1, 0), 10, 'one level: the border of one texel')
})

test('the levels of the gather: the finest holds the border wrapped as an octahedron’s, each coarser is the mean of two by two dithered by the level, and a sample reads the nearest level its cone asks', () => {
  const all = screenProbeSources(
    kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra', screenProbeGatherNumMips: 2 })),
  )
  assert.match(all.fixup!.code, /octWrapBorder\(id\.xy%SP_MIP_SIDE,SP_MIP_SIDE,SP_MIP_BORDER\)/)
  assert.match(all.fixup!.code, /const SP_MIP_SIDE:u32=12u;/)
  assert.match(all.fixup!.code, /const SP_MIP_BORDER:u32=2u;/)
  const mip1 = Object.entries(all).find(([name]) => mipLevelOf(name) === '1')![1]!
  assert.match(mip1.code, /const SP_MIP_LEVEL:u32=1u;/)
  assert.match(mip1.code, /const SP_MIP_PARENT:u32=12u;/)
  assert.match(mip1.code, /const SP_MIP_CHILD:u32=6u;/)
  assert.match(mip1.code, /i32\(SP_MIP_LEVEL\)\+13/)
  assert.match(mip1.code, /sum\/4\.0/)
  const level = (gather: number) =>
    shaderRun<{ spRoughLevel: () => number }>(all.integrate!.code, ['spRoughLevel'], {
      sp: { counts: [0, 0, 0, gather] },
    }).spRoughLevel()
  // Four samples share the cone of a quarter of the half sphere: about a fifth of the gather’s side, in texels, and its base-two logarithm.
  assert.equal(
    level(8),
    1,
    'eight texels: a cone of 1.6 texels, the logarithm 0.67 rounds to the second level',
  )
  assert.equal(level(4), 0, 'four texels: under one texel, the finest level')
  assert.equal(level(16), 1, 'sixteen: 3.2 texels, held to the coarsest level the gather holds')
})
