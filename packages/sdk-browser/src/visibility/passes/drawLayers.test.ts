import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  BASE_SLOTS,
  BIN_KIND,
  CULL_BINS,
  DRAW_ITEM_U32,
  MAX_DRAW_SLOTS,
  slotCount,
} from '../draw/contract.ts'
import { ROW_WORDS } from '../types.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import { createWebgpuVisState, type WebgpuVisState } from '../../frame/backend/state/vis.ts'
import { replayBundles } from '../../../../../tests/kit/fakeDevice/fakeBundles.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createDrawItemWordsHold, refreshDrawItemWords } from './itemWords.ts'
import { drawVis } from './drawVis.ts'
import { visUniformSlots, writeWebgpuVisibilityUniforms } from './uniforms.ts'
import { VIS_UNIFORM, SHADE_UNIFORM } from '../shader/uniformLayout.ts'
import { createEngineCamera } from '../../camera/engineCamera.ts'
import { createWebgpuVisibilityShaders } from './shaders.ts'
import { PAGE_INFO } from '../pageInfo.ts'

// Follow-up of `../../frame/backend/layersState.test.ts`: the per-image draw modules, where the coplanar-
// layer lot was reapplied too. `../../geometry/rows/page/pageRowWriter.ts` stays covered by `../../geometry/rows/page/pageRowDepthBias.test.ts` and has
// no test here.

// itemWords.ts
test("a row's coplanar layer goes into its record word, capped, and its triangles with it", () => {
  const material = G.basicSurface()
  const rec = (depthLayer: number) =>
    ({
      array: Uint32Array.from([0, 1, 2]),
      depthLayer,
      material,
    }) as unknown as PageRec
  // The two page-table rows carry the three indices each page draws.
  const pageTableInts = new Uint32Array(2 * ROW_WORDS)
  pageTableInts[PAGE_INFO.at.indexCount] = 3
  pageTableInts[ROW_WORDS + PAGE_INFO.at.indexCount] = 9
  const layout = {
    rows: {
      packedCount: 2,
      packedRecs: [rec(0), rec(5)],
      packedPageIndex: Int32Array.from([0, 1]),
      pageTableInts,
      tableEpoch: 1,
      rowsEpoch: 1,
      dirtyFrom: 0,
      dirtyTo: 1,
    },
    itemWordsHold: createDrawItemWordsHold(2),
    drawItemWords: new Uint32Array(2 * DRAW_ITEM_U32),
    selectionRoots: [{ world: new Matrix4() }],
    // Both rows draw a page of the one placement: their packed ranks name root 0.
    placement: { baseOfRoot: Int32Array.of(0), packedCount: 2 },
  }
  const rt = { layout, vis: { drawLayerSlots: 3 } } as unknown as WebgpuPagesRuntime
  const hold = refreshDrawItemWords(rt, rt.vis.drawLayerSlots - 1, undefined)
  assert.equal(layout.drawItemWords[3], 0, 'the layer-0 row keeps layer 0')
  assert.equal(
    layout.drawItemWords[DRAW_ITEM_U32 + 3],
    2,
    'a layer deeper than the scene has slots pinches to the last',
  )
  assert.equal(layout.drawItemWords[4], 1, 'the row triangles leave their table row')
  assert.equal(layout.drawItemWords[DRAW_ITEM_U32 + 4], 3)
  assert.equal(hold.total, 4, 'the drawable-triangle total follows the two rows')
})

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
      gpuDraw: { indirectBuffer: {}, instanceBuffer: {}, groupsBuffer: {} },
      gpuRaster: { hardwareGroup: {} },
      visBundles,
      // The surfaces' records a slot's group binds (`../../materials/table/materialTable.ts`).
      materialTable,
    },
    gpu: { cache: { buffer: {} } },
    run: { gpuDrawCalls: 0 },
    layout: { rows: { packedCount: 0 }, itemWordsHold: createDrawItemWordsHold(1) },
  } as unknown as WebgpuPagesRuntime

  drawVis(rt, device, pass, false, false)

  // The call count depends only on the slots: each layer's occluder half, its opaque then its
  // cutout bins, each at its own indirect offset. An empty slot draws zero instances, the GPU knows
  // that alone. No voxel row is held: the voxel bins are not walked; the software bins are the
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
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), slotCount(1) + 2)
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), BASE_SLOTS + 2)
  assert.equal(visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState), slotCount(3) + 2)
})

// shaders.ts
test('createWebgpuVisibilityShaders sizes the visibility uniform buffer for the scene’s coplanar layer count', async () => {
  const { device } = fakeDevice()
  const uniformSlots = visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState)
  const shaders = await createWebgpuVisibilityShaders(device, 8, uniformSlots)
  assert.equal(uniformSlots, 3 * BASE_SLOTS + 2)
  assert.equal((shaders.visUniform as unknown as { size: number }).size, uniformSlots * 256)
})

test('the visibility uniform carries the view’s plane and whether the split routes what reaches behind it', () => {
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
      diagnosticPixelError: 0,
    },
    layout: { rows: { packedCount: 3 } },
    gpu: { targetSize: [64, 32], displaySize: [64, 32], temporal: undefined },
    setup: { pixelRatio: () => 1 },
    capture: { capturing: false },
    context: {},
  } as unknown as WebgpuPagesRuntime
  const U = VIS_UNIFORM.at,
    read = () => ({
      plane: Array.from(slots(rt).slice(U.clipPlane, U.clipPlane + 4)),
      route: new Uint32Array(slots(rt).buffer)[U.clipRoute],
    })
  const write = () => writeWebgpuVisibilityUniforms(rt, device, cam, 4)
  // A camera whose plane the host has not allowed: nothing to clip.
  cam.viewSet = Object.freeze({ clipPlane: [0, 0, 1, 2], hidden: [], showOnly: null }) as never
  write()
  assert.deepEqual(read(), { plane: [0, 0, 0, 0], route: 0 })
  // Allowed: the unit normal and the offset the other way round, the cut's cull routing the split.
  Object.assign(rt.context, { cutClipPlane: true })
  write()
  assert.deepEqual(read(), { plane: [0, 0, 1, -2], route: 1 })
  Object.assign(rt.context, { cutClipPlaneCulling: false })
  write()
  assert.deepEqual(read(), { plane: [0, 0, 1, -2], route: 0 })
})
