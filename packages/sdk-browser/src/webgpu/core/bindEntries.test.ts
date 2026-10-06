import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { createWebgpuVisibilityShaders } from '../visibility/shaders.ts'
import { createWebgpuShadePipelines } from '../visibility/shadePipelines.ts'
import { createWebgpuBlendPipelines } from '../blend/pipelines.ts'
import { ensureWebgpuVisibilityBindings } from '../visibility/bindings.ts'
import { ensureWebgpuShadeBindings } from './shadeBindings.ts'
import { drawBlendPass } from '../blend/draw.ts'
import { blendLightResources } from '../blend/lighting.ts'
import { buildBlendStatics, refreshBlendPlan } from '../blend/plan.ts'
import { surfaceOf } from '../../page/surface.ts'
import { orderBlendPasses } from '../blend/order.ts'
import { createWebgpuBlendState } from '../blend/state.ts'
import { createWebgpuVisState } from '../pages/state/vis.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { VIS_BINDINGS, SHADE_BINDINGS } from './bindLayout.ts'
import { BASE_SLOTS } from '../../gpu/draw/draw.ts'
import { createGpuRaster } from '../../gpu/raster/raster.ts'
import type { WebgpuTileStreamer } from '../tile/streamer.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { visGroupFor } from '../visibility/visGroup.ts'

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
    zeroFlags: token(),
    visView: {} as GPUTextureView,
    textures: stubTextures(),
    mapsSampler: {} as GPUSampler,
    gpuHiz: undefined,
    gpuDraw: { indirectBuffer: token(), instanceBuffer: token(), slotOffsetsBuffer: token() },
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
  const item = {
    index: {} as GPUBuffer,
    position: {} as GPUBuffer,
    uv: {} as GPUBuffer,
    normal: {} as GPUBuffer,
    diagnosticBuffer: {} as GPUBuffer,
    surface: surfaceOf(G.basicSurface()),
    matrix: new G.Matrix4(),
    count: 3,
    group: undefined,
  }
  // The transparent pass encodes one RUN at a time, and the unpaged item is a run on its own.
  const blendState = createWebgpuBlendState()
  blendState.blendGpu.push(item as unknown as (typeof blendState.blendGpu)[number])
  buildBlendStatics(blendState)
  refreshBlendPlan(blendState)
  orderBlendPasses(blendState, [0, 0, 0])
  Object.assign(blendState, { argsBuffer: {}, itemBuffer: {}, viewBuffer: {} })
  const rt = {
    vis,
    gpu: {
      cache: { buffer: {} },
      surfaces: { subsurfaceView: {}, receiverView: {} },
      uniformBuffer: {},
      zeroUv: {},
      targetSize: [4, 4],
      colorView: {},
      depthView: {},
      asIsShare: { view: {} },
      volumeBuffer: {},
      backdrop: { colorView: {}, depthView: {}, active: false },
      deferred: {
        placeholders: { slices: {}, atlasView: {}, sampler: {}, bounceGrid: {}, probes: {} },
      },
      gpuDrawCalls: 0,
    },
    lights: { buffer: {}, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // `lit` view with no light: the contract lights, so the pass binds its default resources.
    blendState,
    run: { gpuDrawCalls: 0, blendDrawCalls: 0, blendSubmittedTriangles: 0 },
  } as unknown as WebgpuPagesRuntime

  // Both constructors of `visBindGroupLayout`: the direct group and that of an indirect slot.
  ensureWebgpuVisibilityBindings(rt, device)
  assert.ok(visGroupFor(rt, device, BASE_SLOTS, false), 'the slot group is built')
  // Resolve shares the prepare-time entries.
  ensureWebgpuShadeBindings(rt, device)
  // PageInfo is a tightly packed storage array, not a dynamically offset binding per row.
  assert.equal(PAGE_INFO_STRIDE, 272)
  for (const [index, binding] of [
    [0, VIS_BINDINGS.pageTable],
    [1, VIS_BINDINGS.pageTable],
    [2, SHADE_BINDINGS.pageTable],
  ]) {
    const group = groups[index] as unknown as GPUBindGroupDescriptor
    const entry = [...group.entries].find((entry) => entry.binding === binding)!
    const resource = entry.resource as GPUBufferBinding
    assert.equal(resource.buffer, vis.pageTable)
    assert.equal(resource.offset ?? 0, 0)
    assert.equal(resource.size ?? resource.buffer.size, 3 * 272)
    const layout = groups[index].layout.entries as GPUBindGroupLayoutEntry[]
    assert.equal(
      layout.find((entry) => entry.binding === binding)!.buffer?.hasDynamicOffset ?? false,
      false,
    )
  }
  // Both constructors of `blendBindGroupLayout`: the group ALL paged items share, then that of
  // an unpaged item, on its own buffers.
  const stub = (noms: string[]) =>
    Object.fromEntries(noms.map((nom) => [nom, () => {}])) as unknown as GPURenderPassEncoder
  const pass = stub(['setViewport', 'setBindGroup', 'setPipeline', 'draw', 'drawIndirect', 'end'])
  blendState.lighting = blendLightResources(rt)
  drawBlendPass(rt, device, { beginRenderPass: () => pass } as unknown as GPUCommandEncoder)

  // The unique constructor of the small-triangle software raster, fifth pair of the path: it
  // reads the same colour pool and the same page table as the other passes.
  const smallPass = stub(['setBindGroup', 'setPipeline', 'dispatchWorkgroups', 'end'])
  const smallEncoder = {
    clearBuffer() {},
    copyBufferToBuffer() {},
    beginComputePass: () => ({ ...smallPass, dispatchWorkgroupsIndirect() {} }),
    beginRenderPass: () => pass,
  } as unknown as GPUCommandEncoder
  const raster = createGpuRaster(device, 4, 4, 8)
  const buffer = {} as GPUBuffer,
    view = {} as GPUTextureView
  const rasterInput = {
    indices: buffer,
    positions: buffer,
    pages: buffer,
    hizFlags: buffer,
    uniform: buffer,
    uvs: buffer,
    textures: vis.textures,
    sampler: vis.mapsSampler,
    pageRows: 1,
    maxTriangles: 3,
    idsView: view,
    depthView: view,
    tested: false,
    groups: [],
    groupKey: 0,
  }
  raster.encodeOccluders(smallEncoder, rasterInput)
  raster.encodeIds(smallEncoder, rasterInput)
  const counted = groups.map((group) => [group.entries.length, group.layout.entries.length])
  assert.equal(counted.length, 7, 'the six constructors ran, the resolver included')
  for (const [built, expected] of counted)
    assert.equal(built, expected, `a group binds ${built} entries for a layout of ${expected}`)
  assert.deepEqual(
    counted.slice(0, 5),
    [
      [visCount, visCount],
      [visCount, visCount],
      [shadeCount, shadeCount],
      [blendCount, blendCount],
      [blendCount, blendCount],
    ],
    'in order: direct group, slot group, hardware resolve, paged then unpaged transparents',
  )
})
