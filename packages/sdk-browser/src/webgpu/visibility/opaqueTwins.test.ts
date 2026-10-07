// Each occluder pipeline has a twin of the same states but for its fragment stage, the one
// that neither reads the page nor discards (`visOpaque.test.ts`: the same image), made with it at
// preparation; a tested pipeline has none, nor any under a diagnostic variant of the raster stage.
// `drawVis` draws each half's opaque slots with the twin, then its cutout slots with the pipeline
// that discards; without indirect draws, each row that is no cutout draws with the twin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { BASE_SLOTS, CULL_BINS, HALF_SLOTS } from '../../gpu/draw/draw.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import {
  createWebgpuCoplanarLayerPipelines,
  createWebgpuVisibilityRasterPipelines,
  opaqueTwin,
} from './pipelines.ts'
import { drawVis } from './drawer.ts'
import { createWebgpuVisState } from '../pages/state/vis.ts'
import { replayBundles } from '../../../../../tests/kit/gpu/fakeBundles.ts'

type Made = GPURenderPipelineDescriptor & GPURenderPipeline
const build = async (variant?: 'geometry-flat') => {
  const { device } = fakeDevice()
  const [module, layout] = [{} as GPUShaderModule, {} as GPUBindGroupLayout]
  const raster = await createWebgpuVisibilityRasterPipelines(device, module, layout, variant)
  const layers = await createWebgpuCoplanarLayerPipelines(device, module, layout, 2, variant)
  const { visHizRestBack, visHizRestNone, visHizRestFront, ...occluders } = raster
  return {
    ...{ device, raster, layers, all: [...Object.values(raster), ...layers] as Made[] },
    occluders: [...Object.values(occluders), ...layers.slice(0, 3)] as Made[],
    tested: [visHizRestBack, visHizRestNone, visHizRestFront, ...layers.slice(3)] as Made[],
  }
}

test("an occluder's twin is itself but for the opaque fragment stage", async () => {
  const { occluders, tested } = await build()
  for (const pipeline of occluders) {
    const twin = opaqueTwin(pipeline) as Made
    assert.equal(twin.fragment!.entryPoint, 'vis_hiz_opaque_fs')
    assert.deepEqual({ ...twin, fragment: pipeline.fragment }, pipeline)
  }
  assert.ok(
    tested.every((pipeline) => !pipeline || !opaqueTwin(pipeline)),
    'no tested twin',
  )
})

test('a diagnostic raster stage imposes itself: no twin', async () => {
  const { all } = await build('geometry-flat')
  assert.ok(all.every((pipeline) => !pipeline || !opaqueTwin(pipeline)))
})

/** The pipelines `drawVis` sets and the indirect offsets it draws. */
async function drawn(rest: boolean, compacted = false) {
  const { device, raster, layers } = await build()
  const set: Made[] = [],
    offsets: number[] = []
  const pass = {
    setPipeline: (pipeline: Made) => set.push(pipeline),
    setBindGroup() {},
    draw() {},
    drawIndirect: (_: unknown, offset: number) => offsets.push(offset),
    executeBundles: (bundles: GPURenderBundle[]): void => replayBundles(pass, bundles),
  } as unknown as GPURenderPassEncoder
  const material = surfaceOf(G.basicSurface())
  const rt = {
    vis: {
      ...raster,
      drawLayerSlots: 2,
      visLayerPipelines: layers,
      visBindGroupLayout: {},
      gpuHiz: { flags: {} },
      zeroFlags: {},
      visSlotGroups: new Array(4 * BASE_SLOTS).fill({}),
      gpuDraw: { indirectBuffer: {} },
      visBundles: createWebgpuVisState().visBundles,
    },
    run: { gpuDrawCalls: 0 },
    layout: {
      rows: {
        packedCount: 4,
        packedRecs: Array.from({ length: 4 }, () => ({
          material,
          depthLayer: 0,
          array: [0, 0, 0],
        })),
        packedPageIndex: [0, 1, 2, 3],
      },
      placement: { rootOfPacked: [0, 0, 0, 0] },
      selectionRoots: [{ world: new G.Matrix4() }],
    },
  } as unknown as WebgpuPagesRuntime
  drawVis(rt, device, pass, rest, compacted)
  return { set: set.map((pipeline) => pipeline.fragment!.entryPoint), offsets }
}

test('each half draws its opaque slots with the twin, then its cutout slots with the cut', async () => {
  const [cut, opaque] = ['vis_hiz_fs', 'vis_hiz_opaque_fs']
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
  // The tested half draws with the occluders' pipelines once compacted, their twins included.
  const compacted = await drawn(true, true)
  assert.deepEqual(compacted.set, [...layer, ...layer])
  assert.deepEqual(
    compacted.offsets,
    slots.map((s) => (s + HALF_SLOTS) * 16),
  )
  const tested = await drawn(true)
  assert.deepEqual(tested.set, Array(12).fill(cut), 'a tested pipeline has no twin')
})
