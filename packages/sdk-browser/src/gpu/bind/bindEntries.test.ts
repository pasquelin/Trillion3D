import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { createWebgpuVisibilityShaders } from '../../visibility/passes/shaders.ts'
import { createWebgpuShadePipelines } from '../../visibility/passes/shadePipelines.ts'
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts'
import { ensureWebgpuVisibilityBindings } from '../../visibility/passes/bindings.ts'
import { ensureWebgpuShadeBindings } from './shadeBindings.ts'
import { drawBlendPass } from '../../blend/draw.ts'
import { blendLightResources } from '../../blend/lighting.ts'
import { refreshBlendPlan } from '../../blend/plan/plan.ts'
import { buildBlendStatics } from '../../blend/statics.ts'
import { uniformStride } from '../../session/memory/pools.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { orderBlendPasses } from '../../blend/order/order.ts'
import { createWebgpuBlendState } from '../../blend/state.ts'
import { createWebgpuVisState } from '../../frame/backend/state/vis.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/types.ts'
import { VIS_BINDINGS, SHADE_BINDINGS } from './bindLayout.ts'
import { BASE_SLOTS } from '../../visibility/draw/contract.ts'
import { createGpuRaster } from '../../visibility/raster/raster.ts'
import { RASTER_PASS_MAIN } from '../../visibility/raster/contract.ts'
import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { visGroupFor } from '../../visibility/passes/visGroup.ts'
import { reflectionFront } from '../../lighting/reflections/frontDepth.fixture.ts'

type Recorded = { layout: { entries: unknown[] }; entries: unknown[] }

/** Streamer in the shape constructors read: three lane views and one table per atlas, plus feedback. */
function stubTextures() {
  const atlas = () => ({
    views: [{}, {}, {}] as GPUTextureView[],
    pages: { buffer: {} as GPUBuffer },
  })
  return {
    color: atlas(),
    data: atlas(),
    feedback: { buffer: {} as GPUBuffer },
  } as unknown as WebgpuTileStreamer
}

/** Everything a constructor reads on `rt.vis`: tokens, only their count is checked here. */
function stubVis(layouts: Record<string, unknown>) {
  const token = () => ({}) as GPUBuffer
  return {
    ...createWebgpuVisState(),
    ...layouts,
    concatPos: token(),
    concatUv: token(),
    concatNrm: { buffer: token(), offset: 256, size: 28 },
    pageTable: { size: 3 * PAGE_INFO_STRIDE } as GPUBuffer,
    visUniform: token(),
    shadeUniform: token(),
    shadeCache: { buffer: token() },
    voxelSteps: { buffer: token() },
    zeroRows: token(),
    visView: {} as GPUTextureView,
    textures: stubTextures(),
    mapsSampler: {} as GPUSampler,
    gpuHiz: undefined,
    gpuDraw: { indirectBuffer: token(), instanceBuffer: token(), groupsBuffer: token() },
  }
}

test('each bind-group constructor binds exactly the entries of its layout', async () => {
  const { device, bindGroups } = fakeDevice()
  const groups = bindGroups as unknown as Recorded[]
  const { visBindGroupLayout, visModule } = await createWebgpuVisibilityShaders(device, 8)
  void visModule
  const { shadeBindGroupLayout } = await createWebgpuShadePipelines(
    device,
    {} as GPUShaderModule,
    [],
  )
  const { blendBindGroupLayout, blendPipelines } = await createWebgpuBlendPipelines(device, [])
  const visCount = (visBindGroupLayout as unknown as { entries: unknown[] }).entries.length,
    shadeCount = (shadeBindGroupLayout as unknown as { entries: unknown[] }).entries.length,
    blendCount = (blendBindGroupLayout as unknown as { entries: unknown[] }).entries.length

  const layouts = { visBindGroupLayout, shadeBindGroupLayout, blendBindGroupLayout }
  const vis = stubVis({ ...layouts, blendPipelines })
  const item = { surface: surfaceOf(G.basicSurface()), matrix: new Matrix4() }
  // The transparent pass encodes one RUN at a time, every item on the one shared group.
  const blendState = createWebgpuBlendState()
  blendState.blendGpu.push(item as unknown as (typeof blendState.blendGpu)[number])
  buildBlendStatics(blendState, uniformStride())
  refreshBlendPlan(blendState)
  orderBlendPasses(blendState, [0, 0, 0])
  // The indirect arguments the transparents' draws read, a buffer of the device.
  const argsBuffer = device.createBuffer({
    size: 4096,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  Object.assign(blendState, { argsBuffer, itemBuffer: {}, viewBuffer: {} })
  const rt = {
    vis,
    gpu: {
      reflection: reflectionFront(),
      cache: { buffer: {} },
      surfaces: { subsurfaceView: {}, receiverView: {}, lobesView: {}, lobes: { width: 1 } },
      zeroUv: {},
      targetSize: [4, 4],
      colorView: {},
      depthView: {},
      asIsShare: { view: {}, givenUpView: {} },
      backdrop: { colorView: {}, depthView: {}, active: false },
      deferred: {
        placeholders: { slices: {}, atlasView: {}, sampler: {}, bounceGrid: {}, probes: {} },
      },
      gpuDrawCalls: 0,
    },
    lights: { buffer: {}, store: { count: 0, epoch: 0, unlit: false } },
    bounce: { probes: undefined },
    // `lit` view with no light: the contract lights, so the pass binds its default resources.
    blendState,
    run: { gpuDrawCalls: 0, blendDrawCalls: 0, blendSubmittedTriangles: 0 },
  } as unknown as WebgpuPagesRuntime

  // The constructor of `visBindGroupLayout`: the group of an indirect slot.
  ensureWebgpuVisibilityBindings(rt)
  assert.ok(visGroupFor(rt, device, BASE_SLOTS), 'the slot group is built')
  // Resolve shares the prepare-time entries.
  ensureWebgpuShadeBindings(rt, device)
  // PageInfo is a tightly packed storage array, not a dynamically offset binding per row.
  assert.equal(PAGE_INFO_STRIDE, 176)
  for (const [index, binding] of [
    [0, VIS_BINDINGS.pageTable],
    [1, SHADE_BINDINGS.pageTable],
  ]) {
    const group = groups[index] as unknown as GPUBindGroupDescriptor
    const entry = [...group.entries].find((entry) => entry.binding === binding)!
    const resource = entry.resource as GPUBufferBinding
    assert.equal(resource.buffer, vis.pageTable)
    assert.equal(resource.offset ?? 0, 0)
    assert.equal(resource.size ?? resource.buffer.size, 3 * PAGE_INFO_STRIDE)
    const layout = groups[index].layout.entries as GPUBindGroupLayoutEntry[]
    assert.equal(
      layout.find((entry) => entry.binding === binding)!.buffer?.hasDynamicOffset ?? false,
      false,
    )
  }
  // The constructor of `blendBindGroupLayout`: the group ALL items share.
  const encoder = device.createCommandEncoder()
  blendState.lighting = blendLightResources(rt)
  drawBlendPass(rt, device, encoder)

  // The constructors of the visibility raster, fourth set of the path: the hardware raster's group
  // over the visibility buffer, then the software raster's, its binning's and the resolve's. The
  // software raster reads the same colour pool and the same page table as the other passes.
  const raster = createGpuRaster(device, 4, 4, 8)
  const buffer = {} as GPUBuffer,
    view = {} as GPUTextureView
  const rasterInput = {
    indices: buffer,
    positions: buffer,
    pages: buffer,
    uniform: buffer,
    postUniformOffset: 0,
    uvs: buffer,
    textures: vis.textures,
    sampler: vis.mapsSampler,
    material: view,
    normals: view,
    items: buffer,
    pageRows: 1,
    idsView: view,
    depthView: view,
    hizView: view,
  }
  raster.encodeBinning(encoder, rasterInput, RASTER_PASS_MAIN)
  raster.encodeIds(encoder, rasterInput, [4, 4], false)
  const counted = groups.map((group) => [group.entries.length, group.layout.entries.length])
  assert.equal(counted.length, 7, 'every constructor ran, the visibility raster’s four included')
  for (const [built, expected] of counted)
    assert.equal(built, expected, `a group binds ${built} entries for a layout of ${expected}`)
  assert.deepEqual(
    counted.slice(0, 3),
    [
      [visCount, visCount],
      [shadeCount, shadeCount],
      [blendCount, blendCount],
    ],
    'in order: slot group, hardware resolve, transparents',
  )
})
