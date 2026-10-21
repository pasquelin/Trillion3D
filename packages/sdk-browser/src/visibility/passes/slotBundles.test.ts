// The visibility raster's slot draws read their instance counts from the indirect commands the GPU
// wrote: each half's stream names only pipelines, groups and offsets that outlive the frame, so it
// is recorded once as a render bundle and replayed by every image over the same slots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayBundles } from '../../../../../tests/kit/fakeDevice/fakeBundles.ts'
import { BASE_SLOTS, BIN_KIND, CULL_BINS } from '../draw/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createWebgpuVisState } from '../../frame/backend/state/vis.ts'
import { drawVis } from './drawer.ts'
import { createDrawItemWordsHold } from './itemWords.ts'
import { VIS_DEPTH } from './pipelines.ts'

/** The slots a half walks while no voxel row is held: its opaque and cutout bins. */
const DRAWN = BIN_KIND.VOXEL * CULL_BINS

/** A runtime of one layer whose slots all have their pipeline and group, under a pyramid. */
function slots() {
  const { device, bundles } = fakeDevice()
  const pipeline = (name: string) => ({ name }) as unknown as GPURenderPipeline
  const vis = Object.assign(createWebgpuVisState(), {
    ...{ visPipelineBack: pipeline('back'), visPipelineNone: pipeline('none') },
    visPipelineFront: pipeline('front'),
    visBindGroupLayout: {} as GPUBindGroupLayout,
    zeroRows: {} as GPUBuffer,
    gpuDraw: { indirectBuffer: {} },
    gpuRaster: { hardwareGroup: {} },
  })
  vis.visSlotGroups.fill({} as GPUBindGroup, 0, BASE_SLOTS)
  const rt = {
    vis,
    run: { gpuDrawCalls: 0 },
    layout: { itemWordsHold: createDrawItemWordsHold(1) },
  } as unknown as WebgpuPagesRuntime
  const offsets: number[] = []
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    drawIndirect: (_: GPUBuffer, offset: number) => void offsets.push(offset),
    executeBundles: (list: GPURenderBundle[]): void => replayBundles(pass, list),
  } as unknown as GPURenderPassEncoder
  const draw = (rest: boolean) => drawVis(rt, device, pass, rest, false)
  return { rt, vis, bundles, offsets, draw }
}

test('an image over the same slots replays the bundle its first image recorded', () => {
  const { rt, bundles, offsets, draw } = slots()
  draw(false)
  draw(false)
  assert.equal(bundles.length, 1, 'recorded once')
  const half = Array.from({ length: DRAWN }, (_, slot) => slot * 16)
  assert.deepEqual(offsets, [...half, ...half], 'each image draws every slot it walks')
  assert.equal(rt.run.gpuDrawCalls, 2 * DRAWN, 'each draw counts, replayed or recorded')
  const [{ descriptor }] = bundles
  assert.deepEqual(
    [[...descriptor.colorFormats], descriptor.depthStencilFormat, descriptor.depthReadOnly],
    [[], VIS_DEPTH.format, true],
    'recorded for the read-only depth the pass attaches alone',
  )
})

test('voided slot groups record the half again; each half holds its own bundle', () => {
  const { vis, bundles, draw } = slots()
  draw(false)
  // A held frame walks no slot: what it compares is the revision the groups are voided under.
  vis.visSlotGroups[0] = {} as GPUBindGroup
  draw(false)
  assert.equal(bundles.length, 1, 'no void announced: the held half replays')
  vis.visGroupsRevision++
  draw(false)
  assert.equal(bundles.length, 2, 'voided: the half is walked and recorded again')
  // The tested half records its own bundle once, then replays it.
  for (let image = 0; image < 3; image++) draw(true)
  assert.equal(bundles.length, 3)
})

test('a half walked before a slot group could be made is walked again until it is', () => {
  const { rt, vis, bundles, offsets, draw } = slots()
  // Slot 1's group.
  vis.visSlotGroups[1] = undefined
  vis.visBindGroupLayout = undefined as never
  draw(false)
  assert.deepEqual([bundles.length, offsets.length], [1, 0], 'no layout: nothing binds, held')
  draw(false)
  assert.equal(bundles.length, 1)
  // The layout came, slot 1's group cannot be made yet (`visGroupFor`): walked each frame.
  vis.visBindGroupLayout = {} as GPUBindGroupLayout
  Object.assign(rt, { gpu: {} })
  draw(false)
  draw(false)
  assert.equal(bundles.length, 3, 'incomplete: walked again')
  vis.visSlotGroups[1] = {} as GPUBindGroup
  draw(false)
  draw(false)
  assert.equal(bundles.length, 4, 'complete: held from then on')
  assert.equal(offsets.slice(-DRAWN).includes(16), true, 'slot 1 drawn')
})
