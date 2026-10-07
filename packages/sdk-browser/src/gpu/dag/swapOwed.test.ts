// What a dispatch claims of the swap is held as the few values it moves and given back when its
// command buffer is dropped (`swap.ts`, `holdSwap`). A view aside never cuts again a cut it read
// back short: its lists, still in `out`, are copied again at their size. The main cut's lists no
// slot took are copied before a view aside cuts on `out` (`dispatch.ts`, `copyOwed`): the main
// view's readback then needs no cut, and its mask comes back from its region.
import test from 'node:test'
import assert from 'node:assert/strict'
import { differenceRig } from './differenceRig.fixture.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { MAIN_VIEW, createMaskSwap, holdSwap, noteCut, saveRegionFor } from './swap.ts'

const view = (pixelError: number) => ({ ...createSelectionUniforms(), pixelError })
const SWAP = ['dagArm', 'dagClearDrawn', 'dagArm', 'dagRestoreJournal']
/** Every read in flight settles: mappings and parses are microtasks. */
const settled = () => new Promise((done) => setImmediate(done))

test('a dropped command buffer gives back what its dispatch moved of the swap', () => {
  const swap = createMaskSwap()
  swap.regions = 2
  swap.saved = [-1, -1]
  noteCut(swap, MAIN_VIEW, { uniforms: view(1), residency: 0, world: 0 })
  const before = JSON.stringify(swap)
  const undo = holdSwap(swap, 2)
  assert.equal(saveRegionFor(swap, 2), 0, "the main view's journal to its region")
  noteCut(swap, 2, { uniforms: view(4), residency: 0, world: 0 })
  assert.notEqual(JSON.stringify(swap), before)
  undo()
  assert.equal(JSON.stringify(swap), before)
})

/** A rig with a view aside and its regions made, and `draw`: one image of the view aside. */
async function asideRig(cap: number, placements?: number) {
  const rig = await differenceRig(cap, placements)
  const { selection, resources } = rig
  const aside = selection.aside()
  // The view aside asks its region and the main view's of `out`: made at the first image.
  selection.dispatch(view(1))
  await selection.flush()
  const draw = async (uniforms: ReturnType<typeof view>) => {
    const encoder = resources.device.createCommandEncoder()
    const settle = aside.dispatch(uniforms, encoder)
    resources.device.queue.submit([encoder.finish()])
    settle?.(true)
    await aside.flush()
    return rig.encoded()
  }
  return { ...rig, aside, draw }
}

test('a view aside read back short of its cut copies its lists again, without cutting again', async () => {
  const rig = await asideRig(4096, 400)
  const ids = (count: number) => Array.from({ length: count }, (_, k) => k % rig.pageCount)
  rig.cutNext({ asked: ids(10), drawn: ids(10) })
  assert.ok((await rig.draw(view(4))).includes('dagPrepare'), 'its first cut, read whole')
  rig.cutNext({ asked: ids(2000), drawn: ids(10) })
  assert.ok((await rig.draw(view(5))).includes('dagPrepare'), 'a new cut')
  assert.equal(rig.aside.peek()?.uniforms.pixelError, 4, 'read short of it: not adopted')
  const copies = rig.copies()
  assert.deepEqual(await rig.draw(view(5)), [], 'its lists copied again, nothing cut')
  assert.ok(rig.copies() > copies)
  assert.equal(rig.aside.peek()?.result.pageIds.length, 2000, 'read whole at their size')
  const whole = rig.copies()
  assert.deepEqual(await rig.draw(view(5)), [], 'its mask in place, its lists read')
  assert.equal(rig.copies(), whole, 'nothing copied again')
})

test('the main lists no slot copied are copied before a view aside cuts on them', async () => {
  const rig = await asideRig(64)
  const { selection, resources } = rig
  // Both main slots held mapped until the gate opens. The reads chain one behind the other and each
  // maps only once the one before is read: a map asked after the gate opened goes straight through.
  let open = () => {}
  const gate = new Promise<void>((done) => (open = done))
  for (const slot of resources.readback) {
    const map = slot.mapAsync.bind(slot)
    slot.mapAsync = async (mode: GPUMapModeFlags) => (await gate, map(mode))
  }
  rig.cutNext({ asked: [1], drawn: [1, 2] })
  selection.dispatch(view(2))
  selection.dispatch(view(3))
  rig.cutNext({ asked: [3], drawn: [3, 4] })
  rig.encoded()
  selection.dispatch(view(6))
  assert.ok(rig.encoded().includes('dagPrepare'), 'cut with no slot free: its readback is owed')
  open()
  await settled()
  const copies = rig.copies()
  rig.cutNext({ asked: [5], drawn: [5] })
  const aside = await rig.draw(view(9))
  assert.ok(aside.includes('dagPrepare'), 'the view aside cuts on out')
  assert.ok(rig.copies() > copies, "the main cut's lists copied first")
  await settled()
  assert.equal(selection.peek()?.uniforms.pixelError, 6, 'and adopted')
  selection.dispatch(view(6))
  assert.deepEqual(rig.encoded(), SWAP, 'the main view takes its mask back, no cut')
})
