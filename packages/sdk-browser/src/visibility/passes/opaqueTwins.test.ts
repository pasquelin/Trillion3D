// Each occluder pipeline has a twin of the same states but for its fragment stage, the one
// that neither reads the page nor cuts (`visOpaque.test.ts`: the same image), made with it at
// preparation; none under a diagnostic variant of the raster stage. `drawVis` draws each half's
// opaque slots with the twin, then its cutout slots with the pipeline that cuts — both halves and
// every coplanar layer with the same pipelines —, and its voxel slots only on a frame whose table
// holds a voxel cluster. Their modules cut at a view's clip plane only where the project switch is on.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createPresentClasses } from '../../gpu/core/presentClasses.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../../camera/depthConvention.ts'
import { BASE_SLOTS, BIN_KIND, CULL_BINS, HALF_SLOTS } from '../bins/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { askVoxelTwin, createWebgpuVisibilityRasterPipelines, twinOf } from './pipelines.ts'
import { createWebgpuVisibilityShaders } from './shaders.ts'
import { drawVis } from './drawVis.ts'
import { encodeXray } from './xray.ts'
import { createWebgpuVisState } from '../../frame/backend/state/vis.ts'
import { replayBundles } from '../../../../../tests/kit/fakeDevice/fakeBundles.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { voxelWpo } from '../shader/wpoSets.ts'
import { WIDE_ATOMIC_FEATURE } from '../../gpu/core/wideAtomics.ts'

type Made = GPURenderPipelineDescriptor & GPURenderPipeline
const build = async (variant?: 'geometry-flat', wide = false) => {
  const { device } = fakeDevice({ features: wide ? [WIDE_ATOMIC_FEATURE] : [] })
  const [module, layout] = [{} as GPUShaderModule, {} as GPUBindGroupLayout]
  const raster = await createWebgpuVisibilityRasterPipelines(device, module, layout, variant)
  return { device, raster, all: Object.values(raster) as Made[] }
}

test("an occluder's twin is itself but for the opaque fragment stage", async () => {
  for (const wide of [false, true]) {
    const { all } = await build(undefined, wide)
    for (const pipeline of all) {
      const twin = twinOf(pipeline, BIN_KIND.OPAQUE) as Made
      assert.deepEqual(twin.fragment, { ...pipeline.fragment!, constants: { MASKED: 0 } })
      assert.deepEqual({ ...twin, fragment: pipeline.fragment }, pipeline)
    }
  }
})

test('the hardware raster draws once: into the depth test and the identifiers without the 64-bit word, into its word with it', async () => {
  const [split, wide] = [await build(), await build(undefined, true)]
  for (const pipeline of split.all) {
    assert.deepEqual(pipeline.fragment?.targets, [{ format: 'r32uint' }])
    assert.deepEqual(
      [pipeline.depthStencil?.depthWriteEnabled, pipeline.depthStencil?.depthCompare],
      [true, DEPTH_COMPARE_OR_EQUAL],
    )
    assert.equal(
      (pipeline.layout as unknown as { bindGroupLayouts: unknown[] }).bindGroupLayouts.length,
      1,
    )
  }
  for (const pipeline of wide.all) {
    assert.deepEqual([...(pipeline.fragment?.targets ?? [])], [])
    assert.equal(pipeline.depthStencil?.depthWriteEnabled, false)
    assert.equal(
      (pipeline.layout as unknown as { bindGroupLayouts: unknown[] }).bindGroupLayouts.length,
      2,
    )
  }
})

test('a diagnostic raster stage imposes itself: no twin', async () => {
  const { all } = await build('geometry-flat')
  assert.ok(all.every((pipeline) => !pipeline || !twinOf(pipeline, BIN_KIND.OPAQUE)))
})

/** The pipelines `drawVis` sets and the indirect offsets it draws. */
async function drawn(rest: boolean) {
  const { device, raster } = await build()
  const set: Made[] = [],
    offsets: number[] = []
  const pass = {
    setPipeline: (pipeline: Made) => set.push(pipeline),
    setBindGroup() {},
    draw() {},
    drawIndirect: (_: unknown, offset: number) => offsets.push(offset),
    executeBundles: (bundles: GPURenderBundle[]): void => replayBundles(pass, bundles),
  } as unknown as GPURenderPassEncoder
  const rt = {
    vis: {
      ...raster,
      drawLayerSlots: 2,
      visBindGroupLayout: {},
      zeroRows: {},
      visSlotGroups: new Array(2 * BASE_SLOTS).fill({}),
      gpuBins: { indirectBuffer: {} },
      // No voxel cluster: the voxel slots are not walked.
      presentClasses: createPresentClasses(),
      gpuRaster: { wide: false },
      visBundles: createWebgpuVisState().visBundles,
    },
    run: { gpuDrawCalls: 0 },
  } as unknown as WebgpuPagesRuntime
  drawVis(rt, device, pass, rest)
  const stage = ({ fragment }: GPURenderPipelineDescriptor) =>
    fragment!.constants?.MASKED === 0 ? 'unmasked' : fragment!.entryPoint
  return { set: set.map(stage), offsets }
}

test('each half draws its opaque slots with the twin, then its cutout slots with the cut', async () => {
  const [cut, opaque] = ['vis_hiz_fs', 'unmasked']
  // Two layers: each its three opaque slots, then its three cutout ones, at their own offsets.
  const half = [0, 1, 2, 3, 4, 5],
    slots = [...half, ...half.map((s) => BASE_SLOTS + s)]
  const layer = [opaque, opaque, opaque, cut, cut, cut]
  const occluders = await drawn(false)
  assert.deepEqual(occluders.set, [...layer, ...layer])
  assert.deepEqual(
    occluders.offsets,
    slots.map((s) => s * 16),
  )
  assert.equal(CULL_BINS, 3)
  // The tested half draws with the same pipelines, their twins included.
  const tested = await drawn(true)
  assert.deepEqual(tested.set, [...layer, ...layer])
  assert.deepEqual(
    tested.offsets,
    slots.map((s) => (s + HALF_SLOTS) * 16),
  )
})

test('the project switch picks the raster’s modules once: the voxel twins’ text and the surface’s alike', async () => {
  const modules = async (clipping?: 'pixel' | 'distance') => {
    const kit = fakeDevice(),
      codes: string[] = []
    const make = kit.device.createShaderModule.bind(kit.device)
    kit.device.createShaderModule = (d) => (codes.push(d.code), make(d))
    const shaders = await createWebgpuVisibilityShaders(kit.device, 7, undefined, clipping)
    const raster = await createWebgpuVisibilityRasterPipelines(
      kit.device,
      shaders.visModule,
      shaders.visBindGroupLayout,
      undefined,
      clipping,
    )
    // The voxel twins' module is made at the first ask.
    askVoxelTwin(raster.visPipelineFront)
    await new Promise((resolve) => setImmediate(resolve))
    return codes.filter((code) => code.includes('vis_vs') || code.includes('VisVoxelIn'))
  }
  const [off, pixel, distance] = [
    await modules(),
    await modules('pixel'),
    await modules('distance'),
  ]
  // The raster's module and the voxel bricks': one each, whatever the switch.
  assert.deepEqual([off.length, pixel.length, distance.length], [2, 2, 2])
  assert.ok(
    off.every((code) => !code.includes('uni.clipPlane') && !code.includes('clip_distances')),
  )
  assert.ok(pixel.every((code) => code.includes('planeDistance(')))
  assert.ok(distance.every((code) => code.includes('planeDistance(')))
  assert.ok(distance.some((code) => code.includes('enable clip_distances;')))
  assert.ok(pixel.every((code) => !code.includes('clip_distances')))
})

test('the x-ray view’s module follows the project switch the way the raster’s does', () => {
  // The kit's globals hold no colour-write masks, which the x-ray's target names.
  Object.assign(globalThis, { GPUColorWrite: { RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 } })
  const xray = (clipping?: 'pixel' | 'distance') => {
    const kit = fakeDevice(),
      codes: string[] = []
    const make = kit.device.createShaderModule.bind(kit.device)
    kit.device.createShaderModule = (d) => (codes.push(d.code), make(d))
    const rt = {
      run: { diagnostic: 'xray', depthDrawn: true },
      gpu: { hdrView: {} },
      vis: { visBindGroupLayout: {} },
      setup: { clipping },
    } as unknown as WebgpuPagesRuntime
    encodeXray(rt, kit.device, kit.device.createCommandEncoder())
    return codes.filter((code) => code.includes('vis_xray_vs'))
  }
  const [off, pixel, distance] = [xray(), xray('pixel'), xray('distance')]
  assert.deepEqual([off.length, pixel.length, distance.length], [1, 1, 1])
  assert.ok(!off[0].includes('uni.clipPlane') && !off[0].includes('clip_distances'))
  assert.ok(pixel[0].includes('if(in.clip<0.0){discard;}') && !pixel[0].includes('clip_distances'))
  assert.ok(distance[0].includes('enable clip_distances;'))
})

test('the voxel twins’ module holds the offsets of the session’s surfaces, and a session with none the plain module', async () => {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('worldPositionOffset', g.multiply(g.time(), g.constant(1, 0, 0)))
  const voxelModule = async (wpo?: ReturnType<typeof voxelWpo>) => {
    const kit = fakeDevice(),
      codes: string[] = []
    const make = kit.device.createShaderModule.bind(kit.device)
    kit.device.createShaderModule = (d) => (codes.push(d.code), make(d))
    const raster = await createWebgpuVisibilityRasterPipelines(
      kit.device,
      {} as GPUShaderModule,
      {} as GPUBindGroupLayout,
      undefined,
      undefined,
      wpo,
    )
    askVoxelTwin(raster.visPipelineFront)
    await new Promise((resolve) => setImmediate(resolve))
    return codes.find((code) => code.includes('VisVoxelIn'))!
  }
  const moved = await voxelModule(voxelWpo(graphRastersOf([{ graph: g }])))
  assert.match(moved, /let word=materialGraphWord\(page\.material\);/)
  assert.match(moved, /@binding\(\d+\) var<storage, read> uvs/)
  const plain = await voxelModule()
  assert.ok(!plain.includes('materialGraphWord(page.material)') && !plain.includes('graphFrame'))
})
