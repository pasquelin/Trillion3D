import { createGraphFrame } from '../../frame/render/graphFrame.ts'
import { createPresentClasses } from '../../gpu/core/presentClasses.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BASE_SLOTS, BIN_KIND, CULL_BINS, MAX_DRAW_SLOTS, slotCount } from '../bins/contract.ts'
import { createWebgpuVisState, type WebgpuVisState } from '../../frame/backend/state/vis.ts'
import { replayBundles } from '../../../../../tests/kit/fakeDevice/fakeBundles.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { drawVis } from './drawVis.ts'
import { visUniformSlots, writeWebgpuVisibilityUniforms } from './uniforms.ts'
import { VIS_UNIFORM, SHADE_UNIFORM } from '../shader/uniformLayout.ts'
import { createEngineCamera } from '../../camera/engineCamera.ts'
import { createWebgpuVisibilityShaders } from './shaders.ts'
import { NO_VIEW_SET } from '../../../../sdk-core/src/world/camera/viewSet.ts'
import { newGraphClocks, takeGraphClocks } from '../../materials/graph/clocks.ts'
import { SHADING } from '../../materials/surface/pixelModel.ts'

// Follow-up of `../../frame/backend/layersState.test.ts`: the per-image draw modules, where the coplanar-
// layer lot was reapplied too. The layer a cluster carries is its record's, covered by
// `../../geometry/rows/page/pageRowDepthBias.test.ts`.

// drawVis.ts
test("drawVis draws each coplanar layer's slots by their own indirect command", () => {
  const drawCalls: number[] = []
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    drawIndirect(_buffer: unknown, offset: number) {
      drawCalls.push(offset)
    },
    executeBundles: (bundles: GPURenderBundle[]): void => replayBundles(pass, bundles),
  } as unknown as GPURenderPassEncoder
  const { device } = fakeDevice()
  const { visBundles, materialTable } = createWebgpuVisState()
  const rt = {
    vis: {
      drawLayerSlots: 2,
      visPipelineBack: {},
      visPipelineNone: {},
      visPipelineFront: {},
      visBindGroupLayout: {},
      concatPos: {},
      concatUv: {},
      // The float pool's normal atlas, which every slot's group binds (`VIS_BINDINGS.normals`).
      concatNrm: {},
      pageTable: {},
      visUniform: {},
      textures: { color: { views: [{}, {}, {}], pages: { buffer: {} } } },
      mapsSampler: {},
      zeroRows: {},
      gpuHiz: undefined,
      visSlotGroups: new Array(MAX_DRAW_SLOTS).fill(undefined),
      gpuBins: { indirectBuffer: {}, instanceBuffer: {}, slotOffsetBuffer: {} },
      presentClasses: createPresentClasses(),
      gpuRaster: { hardwareGroup: {}, wide: true },
      visBundles,
      // The surfaces' records a slot's group binds (`../../materials/table/materialTable.ts`).
      materialTable,
      graphFrame: createGraphFrame(),
    },
    gpu: { cache: { buffer: {} }, device },
    run: { gpuDrawCalls: 0 },
  } as unknown as WebgpuPagesRuntime

  drawVis(rt, device, pass, false)

  // The call count depends only on the slots: each layer's occluder half, its opaque then its
  // cutout bins, each at its own indirect offset. An empty slot draws zero instances, the GPU knows
  // that alone. No voxel cluster is held: the voxel bins are not walked; the software bins are the
  // software raster's.
  const half = Array.from({ length: BIN_KIND.VOXEL * CULL_BINS }, (_, bin) => bin)
  assert.deepEqual(
    drawCalls,
    [...half, ...half.map((bin) => BASE_SLOTS + bin)].map((slot) => slot * 16),
    'the slots of each layer are drawn in layer order',
  )
  assert.equal(rt.run.gpuDrawCalls, 2 * half.length)
})

// uniforms.ts
test('visUniformSlots grows the visibility uniform slot count with the scene’s coplanar layers', () => {
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), slotCount(1) + 1)
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), BASE_SLOTS + 1)
  assert.equal(visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState), slotCount(3) + 1)
})

// shaders.ts
test('createWebgpuVisibilityShaders sizes the visibility uniform buffer for the scene’s coplanar layer count', async () => {
  const { device } = fakeDevice()
  const uniformSlots = visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState)
  const shaders = await createWebgpuVisibilityShaders(device, uniformSlots)
  assert.equal(uniformSlots, 3 * BASE_SLOTS + 1)
  assert.equal((shaders.visUniform as unknown as { size: number }).size, uniformSlots * 256)
})

test('the image takes its clocks once from the world’s: a paused world freezes the graph’s time, the wall clock runs on', () => {
  const clocks = newGraphClocks()
  let world = 10
  const worldClock = () => world
  const taken = (now: number) => {
    takeGraphClocks(clocks, worldClock, now)
    return { ...clocks }
  }
  assert.deepEqual(taken(5000), { time: 10, realTime: 5 })
  // The world is paused: its clock holds, whatever the wall clock reads.
  assert.deepEqual(taken(7500), { time: 10, realTime: 7.5 })
  assert.deepEqual(taken(9000), { time: 10, realTime: 9 })
  world = 10.25
  assert.deepEqual(taken(9016), { time: 10.25, realTime: 9.016 })
  // An engine with no world (a bench, a test) runs on the wall clock alone.
  takeGraphClocks(clocks, undefined, 12000)
  assert.deepEqual({ ...clocks }, { time: 12, realTime: 12 })
})

test('the visibility uniform carries the view’s plane where the project switch is on, and whether the cut routes what reaches behind it', () => {
  const { device } = fakeDevice(),
    cam = createEngineCamera(),
    slots = (rt: WebgpuPagesRuntime) => rt.vis.visUniPacked
  const rt = {
    vis: {
      drawLayerSlots: 1,
      visUniPacked: new Float32Array(0),
      shadeUniPacked: new Float32Array(SHADE_UNIFORM.words),
      materialTable: { displaced: { count: 0 } },
    },
    run: {
      diagnostic: 'beauty',
      gate: { cam: { near: 0.1, far: 100, perspective: 1 } },
      textureConverging: false,
      frame: 0,
      graphClocks: { time: 12.5, realTime: 340.25 },
      shading: new Float64Array(SHADING.length),
      diagnosticPixelError: 0,
    },
    gpu: { targetSize: [64, 32], displaySize: [64, 32], temporal: undefined },
    setup: { pixelRatio: () => 1, clipping: undefined as 'pixel' | undefined },
    capture: { capturing: false },
    context: {},
  } as unknown as WebgpuPagesRuntime
  const U = VIS_UNIFORM.at,
    read = () => ({
      plane: Array.from(slots(rt).slice(U.clipPlane, U.clipPlane + 4)),
      route: new Uint32Array(slots(rt).buffer)[U.clipRoute],
    })
  const write = () => writeWebgpuVisibilityUniforms(rt, device, cam, 4)
  // A camera with a plane, the project switch off: nothing to clip, nothing to route.
  cam.viewSet = Object.freeze({ clipPlane: [0, 0, 1, 2], hidden: [], showOnly: null }) as never
  write()
  assert.deepEqual(read(), { plane: [0, 0, 0, 0], route: 0 })
  // The clocks a material graph reads are the image's, taken once (`WebgpuRun.graphClocks`): the
  // world's time, and the wall clock beside it.
  assert.equal(rt.vis.shadeUniPacked[SHADE_UNIFORM.at.time], 12.5)
  assert.equal(rt.vis.shadeUniPacked[SHADE_UNIFORM.at.realTime], 340.25)
  // On: the unit normal and the offset the other way round, the cut's cull routing it.
  rt.setup.clipping = 'pixel'
  write()
  assert.deepEqual(read(), { plane: [0, 0, 1, -2], route: 1 })
  Object.assign(rt.context, { cutClipPlaneCulling: false })
  write()
  assert.deepEqual(read(), { plane: [0, 0, 1, -2], route: 0 })
  // A view that has no plane holds zeros, whatever the switch.
  cam.viewSet = NO_VIEW_SET
  write()
  assert.deepEqual(read(), { plane: [0, 0, 0, 0], route: 0 })
})
