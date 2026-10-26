// The projection is two passes, as the reference has two: the suns' (every sun a layer of the suns'
// mask, the adaptive ray count voted by the group in uniform flow) and the local lights' (each pixel
// walks its cell of the light grid, packs up to the configured number of lights in four bits each).
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../../../materials/texture/shaderRule.fixture.ts'
import { commandArgs } from '../../../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { vsmLocalsProjectionWgsl, vsmSunsProjectionWgsl } from './projectionWgsl.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS, VSM_PROJECTION_VIEW_BYTES } from './projectionView.ts'
import { writeVsmProjectionFrame, type VsmProjectionLight } from './projectionPass.ts'
import { camera, sun } from './projectionScene.fixture.ts'
import { pipelinesSettled } from '../../../deferred/compileLedger.ts'
import { vsmLayout } from '../layout.ts'
import { VSM_PROJECTION_HEADER_WORDS, VSM_PROJECTION_VIEW_WORD } from './projectionView.ts'
import { projectionKit } from './projectionKit.fixture.ts'
import { onePassMaskFormat } from './maskFormat.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 })
const SUNS = vsmSunsProjectionWgsl(LAYOUT)
const LOCALS = vsmLocalsProjectionWgsl(LAYOUT, 'rg32uint')

test('the suns’ pass stores a layer a sun under the uniform sun count, the votes in uniform flow', () => {
  const entry = functionsOf(SUNS, ['vsmProjectSuns'])
  assert.equal(entry.match(/textureStore\(/g)?.length, 1)
  assert.match(entry, /for\(var k=0u;k<vsmView\.sunCount;k\+\+\)\{/)
  assert.match(entry, /textureStore\(vsmSunMask,pixel\.pos,k,vec4f\(/)
  assert.match(SUNS, /texture_storage_2d_array<r32float,write>/)
  assert.match(SUNS, /lights:array<VsmProjectionLight,1024>/)
  assert.equal(VSM_PROJECTION_MAX_PASS_LIGHTS, 1024)
  assert.equal(VSM_PROJECTION_VIEW_BYTES, 416 + 1024 * 48)
})

test('the local lights’ pass walks its pixel’s shadowed lights and packs four bits a light', () => {
  const entry = functionsOf(LOCALS, ['vsmProjectLocals', 'vsmMaskPack'])
  assert.equal(entry.match(/textureStore\(/g)?.length, 1)
  assert.match(entry, /textureStore\(vsmLocalMask,pixel\.pos,mask\);/)
  assert.match(entry, /let list=vsmShadowedList\(base\);/)
  assert.match(entry, /lane<min\(list\.y,vsm\.onePassMaxLights\+1u\)/)
  assert.doesNotMatch(LOCALS, /fn vsmPruneLightGrid\(/, 'the marking prunes the grid')
  assert.match(entry, /\(\*mask\)\[lane\/ONE_PASS_MASK_LANES\]\|=/)
  assert.match(LOCALS, /const ONE_PASS_MASK_BITS:u32=4u;/)
  assert.match(LOCALS, /texture_storage_2d<rg32uint,write>/)
  // The mask holds as many words as the number of lights asks.
  assert.deepEqual([1, 8, 9, 16, 17, 32].map(onePassMaskFormat), [
    'r32uint',
    'r32uint',
    'rg32uint',
    'rg32uint',
    'rgba32uint',
    'rgba32uint',
  ])
})

test('nine lights: one vsm.projection pass, each light at its offset of the view', async () => {
  const { project, res, computePasses, upload: uploaded, device } = projectionKit()
  const lights: VsmProjectionLight[] = Array.from({ length: 9 }, (_, k) => ({
    type: 'point',
    mapId: 8192 + 6 * k,
    direction: [0, -1, 0],
    position: [k, 2, 3],
    radius: 10,
  }))
  // The first frame asks the pipelines; the pass is counted once they are compiled.
  project(lights)
  await pipelinesSettled(device)
  project(lights)
  assert.deepEqual(
    computePasses.map(({ label }) => label),
    ['vsm.projection'],
  )
  // The header and the nine records: the shader reads no record past the count.
  const upload = uploaded()
  assert.ok(upload)
  assert.equal(upload.size, 416 + 9 * 48, 'the view uniform, up to its last light')
  const u = new Uint32Array(upload.data.buffer, upload.data.byteOffset, upload.size! / 4)
  const f = new Float32Array(u.buffer, u.byteOffset, u.length)
  assert.equal(u[75], 9, 'the count')
  for (let k = 0; k < 9; k++) {
    const o = VSM_PROJECTION_HEADER_WORDS + 12 * k
    assert.equal(u[o + 9], 8192 + 6 * k, `light ${k}'s map`)
    assert.equal(f[o] + 0, k, `light ${k}'s position, the eye at the origin`)
  }
  assert.equal(u[VSM_PROJECTION_VIEW_WORD.sunCount], 0, 'no sun among them')
  const tooMany = Array.from({ length: VSM_PROJECTION_MAX_PASS_LIGHTS + 1 }, () => lights[0])
  assert.throws(() => writeVsmProjectionFrame(res, { lights: tooMany } as never))
})

test('a pass is encoded for the kind of light the frame holds: suns, local lights, or both', async () => {
  const { project, computePasses, device } = projectionKit()
  const point: VsmProjectionLight = {
    type: 'point',
    mapId: 8192,
    direction: [0, -1, 0],
    position: [0, 2, 3],
    radius: 10,
  }
  const dispatches = () =>
    computePasses.reduce(
      (n, { commands }) => n + commandArgs(commands, 'dispatchWorkgroups').length,
      0,
    )
  // The first frames ask the pipelines of each kind; the passes are counted once they are compiled.
  for (const pass of [[sun], [point]])
    project(pass as VsmProjectionLight[], { width: 8, height: 8, camera, frameIndex: 0 })
  await pipelinesSettled(device)
  for (const [at, [pass, expected]] of [
    // The local lights' pass over the grid the marking pruned.
    [[sun], 1],
    [[point], 1],
    [[sun, point], 2],
  ].entries()) {
    const before = dispatches()
    project(pass as VsmProjectionLight[], { width: 8, height: 8, camera, frameIndex: 2 + at })
    assert.equal(dispatches() - before, expected)
  }
})

test('the view’s sun count is the suns at the head of its records', () => {
  const { project, upload } = projectionKit()
  const point: VsmProjectionLight = {
    type: 'point',
    mapId: 8192,
    direction: [0, -1, 0],
    position: [0, 2, 3],
    radius: 10,
  }
  project([sun, sun, point])
  const data = upload()!.data
  const u = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)
  assert.equal(u[VSM_PROJECTION_VIEW_WORD.sunCount], 2)
})

test('the view’s rays and steps are written into its uniform: a sun’s and a local light’s, the defaults without any', () => {
  const { project, upload } = projectionKit()
  const traced = () => {
    const data = upload()!.data
    const at = VSM_PROJECTION_VIEW_WORD.traceRays
    return [...new Uint32Array(data.buffer, data.byteOffset + 4 * at, 4)]
  }
  project([sun])
  assert.deepEqual(traced(), [8, 8, 4, 4], 'the rays and steps of the defaults')
  const trace = {
    ...{ shadowRayCountDirectional: 4, shadowRayCountLocal: 0 },
    ...{ shadowSamplesPerRayDirectional: 2, shadowSamplesPerRayLocal: 7 },
  }
  project([sun], { trace })
  assert.deepEqual(traced(), [4, 0, 2, 7], 'a sun’s rays and steps, then a local light’s')
})

test('a trace takes the view’s rays and steps for its kind of light, one tap along the axis where its rays are 0', () => {
  const trace = functionsOf(SUNS, ['vsmTraceLight'])
  for (const text of [
    'let rays=select(vsmView.traceRays.y,vsmView.traceRays.x,directional);',
    'var stepCount=i32(select(vsmView.traceRays.w,vsmView.traceRays.z,directional));',
    'let rayCap=max(rays,1u);',
    'if(single){s=0.0;}',
    'ditherWorld=select(vsm.traceDitherLocal*pd.ditherTexels*texel,0.0,single);',
    'ditherUv=select(vsmSunDitherUv(pd,length(viewPosition)),0.0,single);',
  ])
    assert.ok(trace.includes(text), text)
  assert.doesNotMatch(SUNS, /VSM_TRACE_RAYS|VSM_TRACE_STEPS/, 'no constant of the shader')
})
