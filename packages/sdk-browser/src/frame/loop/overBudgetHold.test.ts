// Over budget: a cut larger than the page pool is a steady state under the one cut rule —
// the pages past the budget are drawn by their nearest resident ancestor and never arrive. The
// image must still settle and hold once the pages the pool accepted are resident; the
// budget flag and the pending count of the refused pages must not keep a still camera redrawing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCutPending } from '../../geometry/cut/adoption/pending.ts'
import { admitGpuCut } from '../render/gpuCutAdmission.ts'
import { scene } from '../../geometry/residency/sets.fixture.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { unsettledMask, unsettledReasons } from './unsettled.ts'
import { drawFinalImage, settledRt } from './hold.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

/** The residency path of one GPU-cut image, in the engine's order: publication, admission, the
 *  streaming. */
function overBudgetEngine(slots: number) {
  const world = scene()
  const cutPending = createCutPending(world.packed, world.delta, world.sets.accepts)
  const rt = settledRt()
  Object.assign(rt, { setup: { slots } })
  Object.assign(rt.services, { residencySets: world.sets, cutPending })
  // The event names the host's threshold, the frame's uniforms (`run.selectionUniforms`).
  Object.assign(rt.run, {
    gpuSelection: { peek: () => ({ uniforms: { pixelError: 1 } }) },
    selectionUniforms: { pixelError: 1 },
  })
  const cut = world.packed.map((_, id) => id)
  const image = () => {
    world.delta.apply(cut)
    world.cut()
    // The image draws the cut it asked: pages above the finest level among them.
    world.sets.applyDrawn(world.delta)
    cutPending.apply()
    admitGpuCut(rt)
    // The streaming's slots, the pool's beyond the pinned cover (`streamingSlots`).
    world.stream(slots - 2)
  }
  /** The host serves every page the pool accepted, and nothing else. */
  const serveAccepted = () =>
    world.packed.forEach((rec, id) => {
      if (!world.sets.accepts(rec)) return
      rec.array = new Uint32Array(1)
      cutPending.touch(id)
    })
  return { world, rt, cutPending, image, serveAccepted }
}

test('a cut larger than the page pool settles and holds on a still camera', () => {
  const { world, rt, cutPending, image, serveAccepted } = overBudgetEngine(4)
  image()
  assert.equal(rt.run.coverageBudgetLimited, true, 'the cut asks for more pages than the pool')
  const refused = world.packed.filter((rec) => !world.sets.accepts(rec))
  assert.ok(refused.length > 0, 'some pages of the cut are past the budget')
  assert.ok(cutPending.count > 0, 'the accepted pages are awaited')
  assert.ok(
    cutPending.records.every((rec) => world.sets.accepts(rec)),
    'the host is asked only for the accepted pages',
  )

  serveAccepted()
  // Still camera: the same cut, image after image. The refused pages never get their bytes.
  for (let i = 0; i < 3; i++) image()
  assert.ok(
    refused.every((rec) => !(rec as { array?: unknown }).array),
    'the refused pages never arrive',
  )
  assert.equal(cutPending.count, 0, 'nothing the pool accepted is still awaited')
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), [], 'over budget is a steady state')

  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  const { device } = fakeDevice()
  drawFinalImage(rt, device)
  assert.equal(holdWebgpuFrame(rt, device), true, 'the still image is held')
})
