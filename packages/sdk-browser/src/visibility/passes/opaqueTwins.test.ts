// Each occluder pipeline has a twin of the same states but for its fragment stage, the one
// that neither reads the page nor cuts (`visOpaque.test.ts`: the same image), made with it at
// preparation; none under a diagnostic variant of the raster stage. `drawVis` draws each half's
// opaque slots with the twin, then its cutout slots with the pipeline that cuts — both halves and
// every coplanar layer with the same pipelines —, and its voxel slots only on a frame whose table
// holds a voxel row.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { BASE_SLOTS, BIN_KIND, CULL_BINS, HALF_SLOTS } from '../draw/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createWebgpuVisibilityRasterPipelines, twinOf } from './pipelines.ts'
import { drawVis } from './drawVis.ts'
import { createWebgpuVisState } from '../../frame/backend/state/vis.ts'
import { replayBundles } from '../../../../../tests/kit/fakeDevice/fakeBundles.ts'

type Made = GPURenderPipelineDescriptor & GPURenderPipeline
const build = async (variant?: 'geometry-flat') => {
  const { device } = fakeDevice()
  const [module, layout] = [{} as GPUShaderModule, {} as GPUBindGroupLayout]
  const raster = await createWebgpuVisibilityRasterPipelines(device, module, layout, variant)
  return { device, raster, all: Object.values(raster) as Made[] }
}

test("an occluder's twin is itself but for the opaque fragment stage", async () => {
  const { all } = await build()
  for (const pipeline of all) {
    const twin = twinOf(pipeline, BIN_KIND.OPAQUE, false) as Made
    assert.deepEqual(twin.fragment, {
      ...pipeline.fragment!,
      constants: { MASKED: 0, ID_PHASE: 0 },
    })
    assert.deepEqual({ ...twin, fragment: pipeline.fragment }, pipeline)
  }
})

test('a diagnostic raster stage imposes itself: no twin', async () => {
  const { all } = await build('geometry-flat')
  assert.ok(all.every((pipeline) => !pipeline || !twinOf(pipeline, BIN_KIND.OPAQUE, false)))
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
  const material = surfaceOf(G.basicSurface())
  const rt = {
    vis: {
      ...raster,
      drawLayerSlots: 2,
      visBindGroupLayout: {},
      zeroRows: {},
      visSlotGroups: new Array(2 * BASE_SLOTS).fill({}),
      gpuDraw: { indirectBuffer: {} },
      gpuRaster: { hardwareGroup: {} },
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
      placement: { baseOfRoot: Int32Array.of(0), packedCount: 4 },
      selectionRoots: [{ world: new Matrix4() }],
      // No voxel row: the voxel slots are not walked.
      itemWordsHold: { voxelRows: 0 },
    },
  } as unknown as WebgpuPagesRuntime
  drawVis(rt, device, pass, rest, false)
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
