import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { layoutProblems } from '../../../gpu/core/wgslLayoutMatch.fixture.ts'
import { occlusionStagesOf } from './occlusionDenoiseStages.ts'
import {
  occlusionFinalWgsl,
  occlusionInjestWgsl,
  occlusionRejectionWgsl,
  occlusionTemporalWgsl,
} from './occlusionDenoiseWgsl.ts'
import { shadowSpatialWgsl } from './shadowDenoiseSpatialWgsl.ts'

const PROGRAMS = {
  injest: occlusionInjestWgsl(),
  reconstruct: shadowSpatialWgsl('reconstruct', 'occlusion'),
  web: shadowSpatialWgsl('web', 'occlusion'),
  postFilter: shadowSpatialWgsl('postFilter', 'occlusion'),
  rejection: occlusionRejectionWgsl(),
  temporal: occlusionTemporalWgsl(),
  final: occlusionFinalWgsl(),
}
const ENTRIES = {
  injest: 'occlusionInject',
  reconstruct: 'occlusionReconstruct',
  web: 'occlusionPreConvolve',
  postFilter: 'occlusionPostFilter',
  rejection: 'occlusionRejection',
  temporal: 'occlusionTemporal',
  final: 'occlusionFinal',
} as const

test('every pass has its entry, names no reserved word and binds no light buffer', () => {
  for (const [name, code] of Object.entries(PROGRAMS)) {
    assert.ok(code.includes(`fn ${ENTRIES[name as keyof typeof ENTRIES]}(`), name)
    assert.ok(!/\b(ref|from|meta|target|final|pass|filter|set|use)\s*[:=]/.test(code), name)
    assert.ok(!code.includes('directLights'), name)
  }
})

test('every pass binds what its text declares: each binding it reaches is in its layout, of the kind and format it reads', () => {
  const { device, bindGroupLayouts } = fakeDevice()
  const stages = occlusionStagesOf(device as unknown as GPUDevice)
  assert.equal(bindGroupLayouts.length, Object.keys(stages).length)
  Object.keys(stages).forEach((name, at) => {
    const entries = bindGroupLayouts[at]!.entries as GPUBindGroupLayoutEntry[]
    assert.deepEqual(layoutProblems(PROGRAMS[name as keyof typeof PROGRAMS], [entries]), [], name)
  })
})

test('the injestion reads the occlusion and the distance in the two channels of the trace’s texture; a distance below zero is no sample', () => {
  const code = PROGRAMS.injest
  assert.ok(code.includes('textureLoad(sourceB,at,0).y'))
  assert.ok(
    code.includes(
      'if(hit<0.0){textureStore(outA,at,vec4f(0.0,0.0,SD_RADIUS_INVALID,0.0));return;}',
    ),
  )
  assert.ok(code.includes('vec4f(textureLoad(sourceA,at,0).x,1.0,hit,0.0)'))
})

test('the occlusion’s spatial weight is the squared distance over the reach, the history’s the plane distance over it, both with the normals’ agreement', () => {
  const code = PROGRAMS.reconstruct
  assert.ok(code.includes('saturate(1.0-dot(toRef,toRef)/(reach*reach))*sdNormalsAgree(base,nb)'))
  assert.ok(
    code.includes('saturate(1.0-abs(dot(base.N,base.P-nb.P))/dist)*sdNormalsAgree(base,nb)'),
  )
  assert.ok(code.includes('pow(max(dot(base.N,nb.N),0.0),4.0)'))
})

test('the history convolution is the web at its own spread, the count held to 256', () => {
  assert.ok(PROGRAMS.postFilter.includes('sdWeb(id.xy,dnParams.spread.z)'))
  assert.ok(PROGRAMS.postFilter.includes('min(held,256.0)'))
  assert.ok(!PROGRAMS.postFilter.includes('sdReconstruct('))
})

test('the rejection pre-convolution takes the pixel whole and its four neighbours, brought to one, and writes the two moments', () => {
  const code = PROGRAMS.rejection
  assert.ok(code.includes('ocTake(&acc,centre,light,base,reach,true)'))
  for (const offset of [
    'centre+vec2f(1.0,0.0)',
    'centre-vec2f(1.0,0.0)',
    'centre+vec2f(0.0,1.0)',
    'centre-vec2f(0.0,1.0)',
  ])
    assert.ok(code.includes(offset), offset)
  assert.ok(code.includes('vec4f(first,acc.m1.x,second,acc.m2.x)'))
})

test('the accumulation bounds the history to 6 deviations of the neighbourhood’s moments over a rotated three by three, keeps a tenth of a sample, none for an unlit pixel, and blends up to 256', () => {
  const code = PROGRAMS.temporal
  assert.ok(code.includes('vec2f(f32(2*x-y),f32(x+2*y))'))
  assert.ok(code.includes('mean-6.0*deviation'))
  assert.ok(code.includes('mean+6.0*deviation'))
  assert.ok(code.includes('max(weight,mean.x*0.1)'))
  assert.ok(code.includes('if((base.flags&7u)==1u){weight=0.0;}'))
  assert.ok(code.includes('min(weight,256.0-currentN)'))
  // The reference surface is the pixel's own placed where it stood in the last image.
  assert.ok(code.includes('SdSurface(clip.xyz/clip.w,ssSceneDepth(place.z),base.N,base.flags)'))
})

test('the output is the share that arrived, 1 where the sample has none, in the red', () => {
  assert.ok(PROGRAMS.final.includes('vec4f(select(1.0,v.r,v.g>0.0),0.0,0.0,0.0)'))
})
