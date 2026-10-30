import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { layoutProblems } from '../../../gpu/core/wgslLayoutMatch.fixture.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { diffuseStagesOf } from './diffuseDenoiseStages.ts'
import {
  diffuseFinalWgsl,
  diffusePostFilterWgsl,
  diffusePreConvolveWgsl,
  diffuseReconstructWgsl,
  diffuseTemporalWgsl,
} from './diffuseDenoiseWgsl.ts'
import { STACKOWIAK_SECOND_OFFSETS } from './stackowiakSecond.ts'

const PROGRAMS = {
  reconstruct: diffuseReconstructWgsl(),
  web: diffusePreConvolveWgsl(),
  temporal: diffuseTemporalWgsl(),
  postFilter: diffusePostFilterWgsl(),
  final: diffuseFinalWgsl(),
}
const ENTRIES = {
  reconstruct: 'diffuseReconstruct',
  web: 'diffusePreConvolve',
  temporal: 'diffuseTemporal',
  postFilter: 'diffusePostFilter',
  final: 'diffuseFinal',
} as const

test('every pass assembles, has its entry and binds no light buffer', () => {
  for (const [name, code] of Object.entries(PROGRAMS)) {
    const entry = ENTRIES[name as keyof typeof ENTRIES]
    assertProgramAssembles(code, entry, `the diffuse denoiser's ${name}`)
    assert.ok(!code.includes('directLights'), name)
  }
})

test('every pass binds what its text declares: each binding it reaches is in its layout, of the kind and format it reads', () => {
  const { device, bindGroupLayouts } = fakeDevice()
  const stages = diffuseStagesOf(device as unknown as GPUDevice)
  assert.equal(bindGroupLayouts.length, Object.keys(stages).length)
  Object.keys(stages).forEach((name, at) => {
    const entries = bindGroupLayouts[at]!.entries as GPUBindGroupLayoutEntry[]
    assert.deepEqual(layoutProblems(PROGRAMS[name as keyof typeof PROGRAMS], [entries]), [], name)
  })
})

test('the reconstruction reads the trace as it wrote it: the hit distance and the rays a pixel in the second texture, a miss far', () => {
  const code = PROGRAMS.reconstruct
  assert.ok(code.includes('DfSample(b.g,a*b.g)'))
  assert.ok(code.includes('select(b.r,1.0e20,b.r<0.0)'))
  // The plane test of a tap is bound by the distance its own rays hit at.
  assert.ok(code.includes('w=dfPlane(base,sdSurfaceAt(v.pixel),v.hit)'))
})

test('the reconstruction casts from the pixel of the cell the turn picks, visiting every pixel of a cell of any side', () => {
  const code = PROGRAMS.reconstruct
  assert.ok(
    code.includes('fn dfTurn()->u32{return u32(dnParams.spread.w)%(dfUpscale()*dfUpscale());}'),
  )
  assert.ok(code.includes('vec2i(i32(turn%up),i32(turn/up))'))
  // The cell the nearest ray is found in is a signed division: a pixel nearer the edge than half a cell has a cell before the first.
  assert.ok(code.includes('floor((vec2f(id)-vec2f(f32(up/2u)))/f32(up))'))
  // A pixel is whole in its own sample where it is the one cast this image, for any side.
  assert.ok(code.includes('all(id%vec2u(up)==ray)'))
})

test('the temporal pass bounds the history by the neighbourhood’s box and keeps none where no sample weighed', () => {
  const code = PROGRAMS.temporal
  assert.ok(code.includes('history.c=clamp(held,low,high)*history.n;'))
  assert.ok(code.includes('history=dfZero();'))
  assert.ok(code.includes('let kept=min(history.n,4096.0-current.n);'))
  assert.ok(code.includes('history.c.rgb*dnParams.time.y'))
})

test('the history convolution takes the second subset of the sets, as many taps as the weight asks', () => {
  const code = PROGRAMS.postFilter
  assert.ok(code.includes('stackowiakSecond[4u+track]'))
  assert.ok(code.includes('clamp(4096.0/acc.n,1.0,f32(most))'))
  assert.equal(STACKOWIAK_SECOND_OFFSETS.length, 56 * 4 * 2)
  assert.deepEqual(
    STACKOWIAK_SECOND_OFFSETS.slice(0, 8),
    [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5],
  )
})
