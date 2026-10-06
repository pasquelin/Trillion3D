import test from 'node:test'
import assert from 'node:assert/strict'
import { drawBlendPass } from '../blend/draw.ts'
import { orderBlendPasses } from '../blend/order.ts'
import { encodeWaterPass } from './pass.ts'
import { createWaterPass } from './waterPass.ts'
import { WATER_BINDINGS } from './compositeWgsl.ts'
import { createBackdrop } from '../transparent/transmission.ts'
import { DISPLAY_FORMAT } from '../../scene/surfaceBuffer.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { device, mountDevice, prepared, replay, targets } from './pass.fixture.ts'
import { createWebgpuBlendState } from '../blend/state.ts'
import { createWebgpuVisState } from '../pages/state/vis.ts'
import { createWebgpuPagesLayout } from '../pages/prepare/layout.ts'
import { createWebgpuRunState } from '../pages/state/run.ts'
import { dropVis } from '../pages/io/drops.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from './passLabels.ts'
import { WATER_BYTES_PER_PIXEL } from '../transparent/waterBytes.ts'

/** The prepared scene, its frame targets, and a real water pass built on a counting device. */
async function mounted() {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const mount = mountDevice()
  blendState.water = await createWaterPass(mount.device, {} as never, {} as never)
  return { blendState, gpu, mount, groups: mount.groups, ...replay(blendState, gpu) }
}

test('water writes the reactive value into the frame’s share, with the share composite', async () => {
  const { rt, encoder, passes, gpu, mount } = await mounted()
  gpu.temporalWanted = true
  assert.equal(encodeWaterPass(rt, encoder), true)
  const composite = passes.find((pass) => pass.label === WATER_COMPOSITE_PASS)!
  assert.equal(
    composite.writes.length,
    2,
    'the HDR target and the share, agreeing with its targets',
  )
  assert.equal(composite.writes[1], gpu.asIsShare!.view, 'the share the temporal pass reads')
  assert.deepEqual(mount.formats('composeWaterReactive'), ['rgba16float', 'rg8unorm'])
  // No share the next image: today's composite, one target, the plain pipeline.
  gpu.temporalWanted = false
  encodeWaterPass(rt, encoder)
  assert.equal(passes.at(-1)!.writes.length, 1)
})

test('the water pass follows the blends: frozen backdrop, surfaces, then one composite', async () => {
  const { rt, encoder, passes, counters } = await mounted()
  drawBlendPass(rt, device, encoder)
  assert.equal(encodeWaterPass(rt, encoder), true, 'the pass was encoded')
  assert.deepEqual(
    passes.map((pass) => pass.label),
    ['Trillion3D transparents', WATER_SURFACE_PASS, WATER_COMPOSITE_PASS],
  )
  assert.deepEqual(passes[0].drawn, [0, 2], 'blends draw the two non-transmissive items')
  assert.deepEqual(passes[1].drawn, [1], 'the surface stage draws the transmissive one')
  assert.equal(counters.copies, 1, 'the lit image; the surface pass restores the opaque depth')
  assert.equal(rt.run.blendDrawCalls, 3, 'the surface draws count as transparent draws')
  assert.equal(rt.run.gpuDrawCalls, 5, 'plus the depth restore and the composite')
})

test('water keeps the surface flags temporal antialiasing and the composition read after it', async () => {
  const { rt, encoder, passes, groups, gpu, mount } = await mounted()
  assert.equal(encodeWaterPass(rt, encoder), true)
  const flags = gpu.surfaces!.views()[3],
    word = gpu.colorView
  for (const pass of passes)
    assert.ok(!pass.writes.includes(flags), `${pass.label} writes over the surface flags`)
  const surface = passes.find((pass) => pass.label === WATER_SURFACE_PASS)!
  assert.equal(surface.writes[3], word, 'the rank and opacity go to the display colour')
  assert.equal(surface.writes.length, 5, 'three material surfaces, the word, the feedback')
  assert.equal(groups.last.get(WATER_BINDINGS.word), word, 'the composite reads the word back')
  // The stage's fourth target is the display colour's format, and the backdrop holds no word.
  assert.equal(mount.formats('fsWater')[3], DISPLAY_FORMAT)
  const backdrop = createBackdrop(fakeDevice().device, 8, 8, true)
  assert.deepEqual(Object.keys(backdrop).sort(), [
    'active',
    'color',
    'colorView',
    'waterDepth',
    'waterDepthView',
  ])
  assert.equal(WATER_BYTES_PER_PIXEL, 12, 'a half-float colour and a depth, no word of its own')
})

test('a still frame binds nothing new: the group and the descriptors survive the image', async () => {
  const { rt, encoder, groups } = await mounted()
  encodeWaterPass(rt, encoder)
  const built = groups.created
  assert.ok(built >= 1, 'the composite group was built once')
  encodeWaterPass(rt, encoder)
  assert.equal(groups.created, built, 'the second image builds no group')
  rt.gpu.backdrop = { ...rt.gpu.backdrop!, colorView: {} as never }
  encodeWaterPass(rt, encoder)
  assert.equal(groups.created, built + 2, 'a resized backdrop rebuilds depth and composite groups')
})

test("the shadow maps' double-buffered tables taking turns build one composite group each, once", async () => {
  const { rt, encoder, groups, blendState } = await mounted()
  const lighting = blendState.lighting!,
    tables = [lighting.shadowData, {} as GPUBuffer]
  const frame = (k: number) => {
    blendState.lighting = { ...lighting, shadowData: tables[k % 2] }
    encodeWaterPass(rt, encoder)
  }
  frame(0)
  const built = groups.created
  frame(1)
  assert.equal(groups.created, built + 1, "the other table's frame builds its own group")
  for (let k = 2; k < 8; k++) frame(k)
  assert.equal(groups.created, built + 1, 'then the frames take turns and build nothing')
  const shadowData = groups.last.get(WATER_BINDINGS.shadowData) as GPUBufferBinding
  assert.equal(shadowData.buffer, tables[1])
})

test('glass behind the camera: no copy, no surface pass, no composite', async () => {
  const { rt, encoder, passes, counters, blendState } = await mounted()
  // A frustum whose near plane faces +z rejects a box that lies entirely beyond z = -1.
  blendState.blendPlanes.set([0, 0, -1, -1])
  blendState.blendGpu[1].bounds = new Float64Array([-1, -1, 5, 1, 1, 6])
  orderBlendPasses(blendState, [0, 0, 0])
  assert.equal(blendState.transmissiveInView, 0, 'the only transmissive item is out of view')
  assert.equal(encodeWaterPass(rt, encoder), false)
  assert.equal(counters.copies, 0)
  assert.deepEqual(passes, [])
})

test('without the pass, or without a backdrop, nothing of it is encoded', () => {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const encoder = { copyTextureToTexture: () => assert.fail('no copy without the pass') }
  const rt = {
    gpu,
    blendState,
    run: { diagnostic: 'beauty' },
    capture: {},
  } as unknown as WebgpuPagesRuntime
  assert.equal(encodeWaterPass(rt, encoder as never), false, 'no pass')
  blendState.water = { surfaces: [{}, {}, {}] as never, frame: {} as never }
  gpu.backdrop = undefined
  assert.equal(encodeWaterPass(rt, encoder as never), false, 'no backdrop')
})

test('dropping the visibility path disposes the water pass with the blend pipelines', () => {
  const blendState = createWebgpuBlendState()
  let disposed = 0
  blendState.water = {
    surfaces: [{}, {}, {}] as never,
    frame: { dispose: () => disposed++ } as never,
  }
  const vis = createWebgpuVisState()
  const rt = {
    vis,
    layout: createWebgpuPagesLayout({
      roots: [],
      bootstrap: [],
      slots: 1,
      cap: 1,
      pageBytes: 12,
    } as never),
    run: createWebgpuRunState(),
    gpu: { bindGroups: new Map() },
    blendState,
    capabilities: { materials: '', unsupported: [] as string[] },
  } as unknown as WebgpuPagesRuntime
  dropVis(rt)
  assert.equal(disposed, 1, 'the frame released its group')
  assert.equal(blendState.water, undefined, 'and the frame no longer has a pass to encode')
})

test('a diagnostic view, or a capture from a second camera, keeps the pass out of the frame', async () => {
  const { rt, encoder, counters } = await mounted()
  rt.run.diagnostic = 'wireframe'
  assert.equal(encodeWaterPass(rt, encoder), false, 'the slice draws as a coloured blend')
  rt.run.diagnostic = 'beauty'
  rt.capture.capturing = true
  assert.equal(encodeWaterPass(rt, encoder), false, 'the capture reads the surfaces as opaque')
  rt.capture.capturing = false
  // An image no composition follows keeps its display colour: the word may not borrow it.
  assert.equal(encodeWaterPass(rt, encoder, false), false, 'no composition overwrites the word')
  assert.equal(counters.copies, 0, 'the backdrop is not even frozen')
})
