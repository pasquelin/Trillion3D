// The per-light path (`shadowOnePassProjection` false, `perLightPass.ts`): each shadowed local light gets
// its record, then its mask, which its projection writes into a layer of the mask whole — nothing is cleared before it,
// nothing composited after — and the one-pass local lights' projection is left out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { commandArgs } from '../../../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { pipelinesSettled } from '../../../deferred/compileLedger.ts'
import { fakeHizDepth } from '../hizDepth.fixture.ts'
import { beginPerLightFrame } from './perLightPass.ts'
import { PER_LIGHT_RECORD_AT } from './perLightRecord.ts'
import {
  encodeVirtualShadowProjection,
  writeVsmProjectionFrame,
  type VsmProjectionFrame,
  type VsmProjectionLight,
} from './projectionPass.ts'
import { camera, sun } from './projectionScene.fixture.ts'
import { projectionKit } from './projectionKit.fixture.ts'
import { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'

const view = {} as GPUTextureView
const SOURCE = { depth: view, normalRough: view, flags: view, subsurface: view, lobes: view }
const point = (z: number, radius = 2): VsmProjectionLight => ({
  type: 'point',
  mapId: 8192,
  direction: [0, -1, 0],
  position: [0, 0, z],
  radius,
})

/** The words the queue wrote into the records' buffer, each where it went: the upload sends only the words that changed
 *  (`writeChangedSlots`), so no one write holds them all. */
function recordWords(writes: ReturnType<typeof projectionKit>['writes']) {
  const out = new Int32Array(1024)
  for (const { buffer, offset, data } of writes)
    if (buffer.label === 'vsm.projection.perLight.records')
      out.set(new Int32Array(data.buffer, data.byteOffset, data.byteLength / 4), offset / 4)
  return out
}

/** The kit's frame of `lights` at 64 × 32, written to the view uniform, and the per-light lights of
 *  it, `ranks` their ranks in the light buffer (indexed as the lights), into a mask of `layers` layers. */
function perLightKit(
  lights: VsmProjectionLight[],
  ranks: number[],
  { forceClear = false, layers = 4 } = {},
) {
  const kit = projectionKit()
  const frame: VsmProjectionFrame = {
    device: kit.device,
    hizDepth: fakeHizDepth,
    width: 64,
    height: 32,
    camera,
    frameIndex: 1,
    lights,
  }
  writeVsmProjectionFrame(kit.res, frame)
  const texture = kit.device.createTexture({
    size: [64, 32, layers],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const mask = {
    texture,
    view: texture.createView({ dimension: '2d-array' }),
    layers: Array.from({ length: layers }, () => texture.createView({ dimension: '2d' })),
  }
  const begin = () =>
    beginPerLightFrame({
      device: kit.device,
      res: kit.res,
      frame,
      source: SOURCE,
      mask,
      ranks,
      forceClear,
    })
  return { ...kit, frame, begin }
}

/** A frame of the lights, its pipelines compiled. */
async function compiled(kit: ReturnType<typeof perLightKit>) {
  const lights = kit.begin()!
  lights.ready()
  await pipelinesSettled(kit.device)
  return lights
}

test('a light’s mask is one compute pass: its projection writes the layer whole, no clear before it, no composite after', async () => {
  const kit = perLightKit([sun, point(-5)], [0, 3])
  const lights = kit.begin()!
  assert.equal(lights.count, 1)
  assert.equal(lights.ready(), false, 'the pipelines compile first, the frames waiting for them')
  await pipelinesSettled(kit.device)
  assert.equal(lights.ready(), true)
  kit.commands.length = 0
  lights.encodeMask(kit.encoder, 0)
  assert.deepEqual(kit.commands, ['compute vsm.projection.perLight.project'])
})

test('shadowForcePerLightMaskClear clears the light’s layer to 0 before the projection, and only then', async () => {
  const kit = perLightKit([sun, point(-5)], [0, 3], { forceClear: true })
  const lights = await compiled(kit)
  kit.commands.length = 0
  lights.encodeMask(kit.encoder, 0)
  assert.deepEqual(kit.commands, [
    'render vsm.projection.perLight.clear',
    'compute vsm.projection.perLight.project',
  ])
  assert.deepEqual(kit.passes[0].colors[0]?.clearValue, [0, 0, 0, 0])
})

test('the projection covers the pixels the light reaches, at the light’s own record', async () => {
  const kit = perLightKit([sun, point(-5), point(-6)], [0, 3, 7])
  const lights = await compiled(kit)
  assert.equal(lights.count, 2)
  kit.computePasses.length = 0
  lights.encodeMask(kit.encoder, 1)
  const at = lights.strideWords * 1 + PER_LIGHT_RECORD_AT.rect
  const [rx0, ry0, rx1, ry1] = lights.ints.subarray(at, at + 4)
  const groups = commandArgs(kit.computePasses[0].commands, 'dispatchWorkgroups')[0]
  assert.deepEqual(groups, [Math.ceil((rx1 - rx0) / 8), Math.ceil((ry1 - ry0) / 8), 1])
  const bound = commandArgs(kit.computePasses[0].commands, 'setBindGroup').find(
    ([index]) => index === 1,
  )
  assert.equal(lights.offsets[1], lights.stride)
  assert.deepEqual(
    [...(bound?.[2] as Uint32Array)],
    [lights.stride],
    'light 1’s record, the group’s one dynamic offset',
  )
})

test('the records hold each light’s rectangle, its record in the view, its rank in the light buffer and its layer', () => {
  const kit = perLightKit([sun, point(-5), point(-6)], [0, 3, 7], { layers: 1 })
  const lights = kit.begin()!
  const words = recordWords(kit.writes)
  const stride = lights.strideWords
  for (const [light, record, rank] of [
    [0, 1, 3],
    [1, 2, 7],
  ]) {
    const at = light * stride
    assert.equal(words[at + PER_LIGHT_RECORD_AT.record], record, `light ${light}'s record`)
    assert.equal(words[at + PER_LIGHT_RECORD_AT.rank], rank, `light ${light}'s rank`)
    assert.equal(words[at + PER_LIGHT_RECORD_AT.layer], 0, 'one layer: every light writes it')
    assert.ok(words[at] < words[at + 2] && words[at + 1] < words[at + 3], 'a rectangle')
  }
})

test('a frame whose layers hold its lights’ masks traces none again; a stale one, or one with more lights than layers, traces all', async () => {
  const traced = async (lights: VsmProjectionLight[], ranks: number[]) => {
    const kit = perLightKit(lights, ranks, { layers: 2 })
    const frame = await compiled(kit)
    return () => {
      kit.computePasses.length = 0
      for (let i = 0; i < frame.count; i++) frame.encodeMask(kit.encoder, i)
      return { passes: kit.computePasses.length, frame }
    }
  }
  const fits = await traced([sun, point(-5), point(-6)], [0, 3, 7])
  assert.equal(fits().passes, 2, 'the first frame: every layer is stale')
  assert.equal(fits().passes, 0, 'the next, the projection held: the masks stand')
  fits().frame.markStale()
  assert.equal(fits().passes, 2, 'a projection that ran: traced again')
  assert.equal(fits().passes, 0)
  const over = await traced([sun, point(-5), point(-6), point(-7)], [0, 3, 7, 9])
  assert.equal(over().passes, 3)
  assert.equal(over().passes, 3, 'more lights than layers: each traced in turn, every frame')
})

test('a light that reaches no pixel is left out, and a frame of none has no per-light lights', () => {
  const behind = perLightKit([sun, point(5), point(-5)], [0, 3, 7])
  const lights = behind.begin()!
  assert.equal(lights.count, 1, 'the light behind the eye is out')
  assert.ok(lights.ints[0] < lights.ints[2])
  assert.equal(recordWords(behind.writes)[PER_LIGHT_RECORD_AT.rank], 7)
  assert.equal(perLightKit([sun, point(5)], [0, 3]).begin(), undefined)
  assert.equal(perLightKit([sun], [0]).begin(), undefined, 'no local light at all')
})

test('with the one-pass projection off the local lights’ pass is not encoded, the suns’ is', async () => {
  const kit = perLightKit([sun, point(-5)], [3])
  const source = {
    ...SOURCE,
    deferredView: kit.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM }),
    directLights: kit.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
    tileLights: kit.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
    gridCells: 64,
  }
  const target = {
    suns: view,
    locals: view,
    localFormat: 'r32uint' as const,
    lightGrid: kit.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
  }
  const dispatched = () =>
    kit.computePasses.reduce(
      (n, { commands }) => n + commandArgs(commands, 'dispatchWorkgroups').length,
      0,
    )
  const dispatches = (onePass: boolean) => {
    const before = dispatched()
    const steps = new ComputeRun().begin(kit.encoder)
    encodeVirtualShadowProjection(steps, kit.res, kit.frame, source, { ...target, onePass })
    steps.end()
    return dispatched() - before
  }
  dispatches(true)
  await pipelinesSettled(kit.device)
  assert.equal(dispatches(true), 2, 'the suns’ pass and the one-pass local lights’')
  assert.equal(dispatches(false), 1, 'the suns’ alone')
})
