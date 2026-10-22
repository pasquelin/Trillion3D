// Every camera-bound state is held per view, behind one record, and switched in one
// function (`state/viewSwitch.ts`); a capture draws in a view of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { camera } from './testScenes.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { clippingFor } from '../../gpu/core/clipDistances.ts'
import { buildBlendPipelines } from '../prepare/visibilitySteps.ts'
import { awayCamera, drawnQuad } from './drawnQuad.fixture.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { flushWebgpuPages } from '../render/flush.ts'
import { captureColorView } from '../io/colorCapture.ts'
import { VIEW_GPU_KEYS, VIEW_RUN_KEYS, VIEW_VIS_KEYS, createWebgpuView } from './state/view.ts'
import { releaseWebgpuView, useWebgpuView } from './state/viewSwitch.ts'
import { LIGHT_BUFFER_AT } from './state/lightBufferLayout.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from '../../lighting/fog/viewSlots.ts'

/** What the main view holds in the runtime groups, by reference. */
function heldBy(rt: Awaited<ReturnType<typeof drawnQuad>>['rt']) {
  return [
    ...VIEW_RUN_KEYS.map((key) => rt.run[key]),
    ...VIEW_GPU_KEYS.map((key) => rt.gpu[key]),
    ...VIEW_VIS_KEYS.map((key) => rt.vis[key]),
    rt.run.gate.cam,
  ]
}

test('no reader keeps the main view once another is drawn, and switching back finds it whole', async () => {
  const { rt } = await drawnQuad()
  const main = heldBy(rt),
    shown = [...rt.run.shown],
    eye = [...rt.run.gate.cam.eye],
    temporal = rt.gpu.temporal!,
    sample = temporal.frame.sample
  assert.ok(temporal.frame.hasHistory && rt.vis.gpuHiz)
  const side = createWebgpuView(16, 16)
  useWebgpuView(rt, side)
  const objects = (values: unknown[]) => values.filter((v) => typeof v === 'object' && v)
  // Every runtime group, not only the traded keys: a reader elsewhere holding the main view fails.
  for (const [name, group] of Object.entries(rt).filter(([name]) => name !== 'views'))
    for (const value of objects(Object.values(group ?? {})))
      assert.equal(objects(main).includes(value), false, `${name} still names the main view`)
  renderWebgpuPages(rt, awayCamera())
  await flushWebgpuPages(rt)
  assert.deepEqual(rt.gpu.targetSize, [16, 16])
  assert.equal(rt.vis.gpuHiz!.width, 16, 'the side view draws its own pyramid')
  assert.equal(rt.gpu.temporal, undefined, 'a view made as a capture’s accumulates no history')
  assert.notDeepEqual([...rt.run.gate.cam.eye], eye)
  useWebgpuView(rt, rt.views.main)
  assert.deepEqual(heldBy(rt), main, 'the main view gets back every state it held')
  assert.deepEqual(rt.run.shown, shown)
  assert.deepEqual([...rt.run.gate.cam.eye], eye)
  assert.deepEqual(rt.setup.viewport, [32, 32])
  assert.equal(temporal.frame.hasHistory, true)
  assert.equal(temporal.frame.sample, sample)
  releaseWebgpuView(rt, side)
  renderWebgpuPages(rt, camera())
  await flushWebgpuPages(rt)
  assert.equal(rt.vis.gpuHiz!.width, 32, 'the main view finds its own pyramid back')
  assert.equal(rt.gpu.temporal, temporal, 'its targets fit: history kept')
})

// The pyramid is one of a view's targets (#1483): refused, it is refused as they are, by name,
// and Hi-Z stays the one occlusion path.
test('a Hi-Z pyramid the device refuses another view is refused as its targets, Hi-Z kept', async () => {
  const { rt, gpu, events } = await drawnQuad()
  const side = createWebgpuView(16, 16)
  const pop = gpu.device.popErrorScope.bind(gpu.device)
  let refused = false
  Object.assign(gpu.device, {
    popErrorScope: async () =>
      refused ? pop() : ((refused = true), await pop(), { message: 'Out of memory' }),
  })
  useWebgpuView(rt, side)
  renderWebgpuPages(rt, awayCamera())
  await flushWebgpuPages(rt)
  assert.ok(refused)
  const said = events.findLast((event) => event.phase === 'frame-targets-refused')
  assert.equal(said?.context.reason, 'gpu-out-of-memory', 'the refusal is said, never silent')
  assert.ok(
    events.every((event) => event.context?.dropped !== 'hi-z'),
    'Hi-Z is never dropped',
  )
  releaseWebgpuView(rt, side)
  renderWebgpuPages(rt, camera())
  await flushWebgpuPages(rt)
  assert.ok(rt.vis.gpuHiz, 'Hi-Z kept')
  assert.equal(rt.run.lost, false)
  renderWebgpuPages(rt, camera())
  assert.equal(rt.gpu.targetGrant, undefined, 'the main view draws again, with its pyramid')
})

test('a host resize while another view is drawn lands on the main view', async () => {
  const { rt } = await drawnQuad()
  const host = rt.setup.viewport,
    side = createWebgpuView(16, 16)
  useWebgpuView(rt, side)
  assert.notEqual(rt.setup.viewport, host, 'the side view draws at its own size')
  host[0] = 48
  host[1] = 24
  useWebgpuView(rt, rt.views.main)
  assert.equal(rt.setup.viewport, host)
  assert.deepEqual(rt.setup.viewport, [48, 24])
  releaseWebgpuView(rt, side)
})

// The rows are a cache of what the GPU cut draws (`../../geometry/rows/slots.ts`): a view that draws nothing
// keeps them, and the main view finds its own back.
test('the drawn list follows the cut of the view drawn, the rows its cache', async () => {
  const { rt } = await drawnQuad()
  assert.equal(rt.run.drawn.length, 2)
  const side = createWebgpuView(32, 32)
  useWebgpuView(rt, side)
  renderWebgpuPages(rt, awayCamera())
  await flushWebgpuPages(rt)
  assert.equal(rt.run.drawn.length, 0, 'nothing is drawn for a cut the view does not hold')
  useWebgpuView(rt, rt.views.main)
  renderWebgpuPages(rt, camera())
  await flushWebgpuPages(rt)
  assert.equal(rt.layout.rows.packedCount, 2)
  releaseWebgpuView(rt, side)
})

test("each view keeps its own packed ranks: another view's cut never lands on the main view", async () => {
  // One record serves every placement: the lists are read by packed rank, so the packed
  // lists are the view's as much as its records are.
  const { rt } = await drawnQuad()
  const packed = () =>
    [rt.run.desiredPacked, rt.run.shownPacked, rt.run.drawnPacked].map((l) => [...l])
  const main = packed()
  assert.equal(main[1].length, 2, 'the main view shows its two pages')
  const side = createWebgpuView(32, 32)
  useWebgpuView(rt, side)
  renderWebgpuPages(rt, awayCamera())
  await flushWebgpuPages(rt)
  assert.deepEqual(packed()[1], [], 'the side view shows nothing')
  useWebgpuView(rt, rt.views.main)
  assert.deepEqual(packed(), main, 'the main view finds its own packed lists back')
  releaseWebgpuView(rt, side)
})

test('a capture leaves the main view’s targets, TAA and Hi-Z history intact', async () => {
  const { rt, gpu } = await drawnQuad()
  const main = heldBy(rt),
    temporal = rt.gpu.temporal!,
    frame = { ...temporal.frame },
    noOccluderHistory = rt.run.noOccluderHistory,
    textures = gpu.textures.length
  const pixels = await captureColorView(rt, awayCamera(), { width: 16, height: 16 })
  assert.equal(pixels.length, 16 * 16 * 4)
  assert.equal(rt.views.active, rt.views.main)
  assert.deepEqual(heldBy(rt), main)
  assert.deepEqual({ ...temporal.frame }, frame)
  assert.equal(rt.run.noOccluderHistory, noOccluderHistory)
  assert.deepEqual(rt.setup.viewport, [32, 32])
  assert.equal(rt.capture.capturing, false)
  const made = gpu.textures
    .slice(textures)
    .filter((texture) => texture.label && texture.width === 16)
  assert.ok(
    made.length && made.every((texture) => gpu.destroyed.includes(texture)),
    'the capture view is freed',
  )
})

/** A lit quad under a height fog alone — no volume, no cubemap: nothing else writes the fog's view
 *  block —, its camera, and the planes each write of the block carried. */
async function foggedQuad(options: Parameters<typeof drawnQuad>[0] = {}) {
  const { rt, gpu } = await drawnQuad(options)
  rt.lights.store.setView('lit')
  rt.lights.store.setEnvironment({ exposure: 1, fog: { baseDensity: 0.01 } })
  const planes = () =>
    gpu.writes
      .filter((write) => write.offset === LIGHT_BUFFER_AT.fogView)
      .map(({ data }) => new Float32Array(data.buffer, data.byteOffset, FOG_VIEW_FLOATS))
      .map((block) => Array.from(block.slice(FOG_VIEW_SLOT.clipPlane * 4).slice(0, 4)))
  const cam = camera()
  const draw = async () => {
    for (let i = 0; i < 3; i++) {
      renderWebgpuPages(rt, cam)
      await flushWebgpuPages(rt)
    }
  }
  return { rt, cam, planes, draw }
}

test('the fog starts at the view’s clip plane where the project switch is on: its slot of the light buffer is written once it changes, nothing for a view without one', async () => {
  const { rt, cam, planes, draw } = await foggedQuad({ cutClipPlane: true })
  assert.equal(rt.setup.clipping !== undefined, true, 'the switch was read when the session opened')
  await draw()
  assert.deepEqual(planes(), [], 'no plane: the light buffer is not written')
  cam.clipPlane = { base: [0, 0, 5], normal: [0, 0, 1] }
  // The plane the shaders keep `dot(xyz, p) + w` at least 0 of, its offset taken to the eye,
  // written once.
  await draw()
  const atEye = Math.fround(-5 + rt.run.gate.cam.eye[2])
  assert.deepEqual(planes(), [[0, 0, 1, atEye]])
  await draw()
  assert.equal(planes().length, 1, 'not again while it holds')
  // Taken away: zeros are written, once, the buffer then as it was made.
  cam.clipPlane = null
  await draw()
  assert.deepEqual(planes(), [
    [0, 0, 1, atEye],
    [0, 0, 0, 0],
  ])
})

test('without the project switch a view’s plane reaches nothing, the fog’s slot included, whatever is set later', async () => {
  const { rt, cam, planes, draw } = await foggedQuad()
  cam.clipPlane = { base: [0, 0, 5], normal: [0, 0, 1] }
  await draw()
  assert.deepEqual(planes(), [], 'the plane is ignored')
  // Read once, when the session opened: the setting written now changes nothing.
  Object.assign(rt.context, { cutClipPlane: true })
  await draw()
  assert.deepEqual(planes(), [])
  assert.equal(rt.setup.clipping, undefined)
})

test('the project switch picks every program’s text once, when the session opens: none of the plane’s code without it, the raster’s, the blends’ and the cut’s with it', async () => {
  const texts = async (options: Parameters<typeof drawnQuad>[0]) => {
    const { rt, gpu } = await drawnQuad(options)
    const modules = [
      ...gpu.renderPipelines.map(({ vertex }) => vertex.module),
      ...gpu.computePipelines.map(({ compute }) => compute.module),
    ] as unknown as { code: string }[]
    return { rt, code: modules.map(({ code }) => code).join('\n') }
  }
  const [off, on] = [await texts({}), await texts({ cutClipPlane: true })]
  assert.equal(off.rt.setup.clipping, undefined)
  // The blends a session makes later are made with the same decision (`blendContext`).
  const blends = async (options: Parameters<typeof drawnQuad>[0]) => {
    const { rt, gpu } = await drawnQuad(options)
    const before = gpu.renderPipelines.length
    const items = [{ transmissive: false, surface: { blending: 'normal' } }] as never
    await buildBlendPipelines(rt, gpu.device, items)
    return gpu.renderPipelines
      .slice(before)
      .map(({ vertex }) => (vertex.module as unknown as { code: string }).code)
  }
  const [blendOff, blendOn] = [await blends({}), await blends({ cutClipPlane: true })]
  assert.ok(blendOff.length > 0 && blendOff.every((code) => !code.includes('blendClipped')))
  assert.ok(blendOn.length > 0 && blendOn.some((code) => code.includes('blendClipped')))
  // The kit's device has no `clip-distances`: each fragment leaves the pixel behind the plane.
  assert.equal(on.rt.setup.clipping, 'pixel')
  for (const code of ['planeDistance(uni.clipPlane', 'fn clipPlaneOn()', 'in.clip<0.0'])
    assert.ok(!off.code.includes(code), `${code} is not in a program without the switch`)
  for (const code of ['planeDistance(uni.clipPlane', 'fn clipPlaneOn()', 'in.clip<0.0'])
    assert.ok(on.code.includes(code), `${code} is in a program with it`)
  // Read once: the setting written later changes nothing.
  Object.assign(off.rt.context, { cutClipPlane: true })
  assert.equal(off.rt.setup.clipping, undefined)
  // The way follows the device: the hardware's where it has `clip-distances`, none without the switch.
  const granted = fakeDevice({ features: ['clip-distances'] }).device
  assert.equal(clippingFor({ cutClipPlane: true, gpuDevice: granted }), 'distance')
  assert.equal(clippingFor({ cutClipPlane: false, gpuDevice: granted }), undefined)
  assert.equal(clippingFor({ cutClipPlane: true }), undefined, 'no device, no programs')
})
