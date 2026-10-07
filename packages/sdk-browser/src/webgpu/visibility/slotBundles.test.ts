// The visibility raster's slot draws read their instance counts from the indirect commands the GPU
// wrote: each half's stream names only pipelines, groups and offsets that outlive the frame, so it
// is recorded once as a render bundle and replayed by every image over the same slots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { replayBundles } from '../../../../../tests/kit/gpu/fakeBundles.ts'
import { BASE_SLOTS, HALF_SLOTS } from '../../gpu/draw/draw.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createWebgpuVisState } from '../pages/state/vis.ts'
import { drawVis } from './drawer.ts'
import { VIS_DEPTH, VIS_TARGETS } from './pipelines.ts'

/** A runtime of one layer whose slots all have their pipeline and group, under a pyramid. */
function slots() {
  const { device, bundles } = fakeDevice()
  const pipeline = (name: string) => ({ name }) as unknown as GPURenderPipeline
  const vis = Object.assign(createWebgpuVisState(), {
    ...{ visPipelineBack: pipeline('back'), visPipelineNone: pipeline('none') },
    ...{ visPipelineFront: pipeline('front'), visHizRestBack: pipeline('tested back') },
    ...{ visHizRestNone: pipeline('tested none'), visHizRestFront: pipeline('tested front') },
    visBindGroupLayout: {} as GPUBindGroupLayout,
    zeroFlags: {} as GPUBuffer,
    gpuHiz: { flags: {} },
    gpuDraw: { indirectBuffer: {} },
  })
  vis.visSlotGroups.fill({} as GPUBindGroup, 0, 2 * BASE_SLOTS)
  const rt = { vis, run: { gpuDrawCalls: 0 } } as unknown as WebgpuPagesRuntime
  const offsets: number[] = []
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    drawIndirect: (_: GPUBuffer, offset: number) => void offsets.push(offset),
    executeBundles: (list: GPURenderBundle[]): void => replayBundles(pass, list),
  } as unknown as GPURenderPassEncoder
  const draw = (rest: boolean, compacted = false) => drawVis(rt, device, pass, rest, compacted)
  return { rt, vis, bundles, offsets, draw }
}

test('an image over the same slots replays the bundle its first image recorded', () => {
  const { rt, bundles, offsets, draw } = slots()
  draw(false)
  draw(false)
  assert.equal(bundles.length, 1, 'recorded once')
  const half = Array.from({ length: HALF_SLOTS }, (_, slot) => slot * 16)
  assert.deepEqual(offsets, [...half, ...half], 'each image draws every slot')
  assert.equal(rt.run.gpuDrawCalls, 2 * HALF_SLOTS, 'each draw counts, replayed or recorded')
  const [{ descriptor }] = bundles
  assert.deepEqual(
    [[...descriptor.colorFormats], descriptor.depthStencilFormat],
    [VIS_TARGETS.map(({ format }) => format), VIS_DEPTH.format],
    'recorded for the identifiers, the pyramid level 0 and the depth the pass attaches',
  )
})

test('voided slot groups record the half again; the tested half holds both its keys', () => {
  const { vis, bundles, draw } = slots()
  draw(false)
  // A held frame walks no slot: what it compares is the revision the groups are voided under.
  vis.visSlotGroups[0] = {} as GPUBindGroup
  draw(false)
  assert.equal(bundles.length, 1, 'no void announced: the held half replays')
  vis.visGroupsRevision++
  draw(false)
  assert.equal(bundles.length, 2, 'voided: the half is walked and recorded again')
  // Compacted or not, the tested half alternates pipelines: each recorded once, then replayed.
  for (const compacted of [true, false, true, false]) draw(true, compacted)
  assert.equal(bundles.length, 4)
})

test('a half walked before a slot group could be made is walked again until it is', () => {
  const { rt, vis, bundles, offsets, draw } = slots()
  // Slot 1's occluder group (`slot · 2 + tested`).
  vis.visSlotGroups[2] = undefined
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
  vis.visSlotGroups[2] = {} as GPUBindGroup
  draw(false)
  draw(false)
  assert.equal(bundles.length, 4, 'complete: held from then on')
  assert.equal(offsets.slice(-HALF_SLOTS).includes(16), true, 'slot 1 drawn')
})
