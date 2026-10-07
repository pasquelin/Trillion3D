// A view drawn aside cuts on the main cut's tables (#1483): its mask replaces the main view's. Each
// view has a region of `out` of its own, made when the first view aside asks: the main view takes
// its mask back from its saved journal when its cut still stands, read back whole — no descent —,
// and so does the view aside; a view whose mask is in place runs nothing. A cut that moved, or drew
// past its list, cuts again (`swap.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { differenceRig } from './differenceRig.fixture.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import {
  MAIN_VIEW,
  createMaskSwap,
  noteCut,
  noteWhole,
  regionsWanted,
  releaseAsideView,
  restorable,
  sameCut,
  saveRegionFor,
  stampMatches,
  takeAsideView,
} from './swap.ts'
import { createDagRuntimeState, recutMain } from './runtimeState.ts'
import { REGION_NONE } from './shader/swapWgsl.ts'

const view = (pixelError: number) => ({ ...createSelectionUniforms(), pixelError })
const SWAP = ['dagArm', 'dagClearDrawn', 'dagArm', 'dagRestoreJournal']

test('the main view and a view aside hand the mask back and forth without a cut', async () => {
  const rig = await differenceRig(64)
  const { selection, resources } = rig,
    { swap } = resources
  const main = view(1),
    side = view(4)
  const aside = selection.aside()
  const drawAside = async () => {
    const encoder = resources.device.createCommandEncoder()
    const settle = aside.dispatch(side, encoder)
    resources.device.queue.submit([encoder.finish()])
    settle?.(true)
    await aside.flush()
    return rig.encoded()
  }
  // The view aside asks its region and the main view's of `out`: no cut runs until they are made.
  selection.dispatch(main)
  await selection.flush()
  assert.equal(swap.regions, 2, 'two regions, made at the first image')
  rig.cutNext({ asked: [], drawn: [1, 2, 3] })
  selection.dispatch(main)
  await selection.flush()
  assert.ok(rig.encoded().includes('dagPrepare'), 'the main view cuts')
  const mainCut = swap.cut
  rig.cutNext({ asked: [], drawn: [4, 5] })
  assert.ok((await drawAside()).includes('dagPrepare'), 'the view aside cuts')
  assert.equal(swap.saved[0], mainCut, "the main view's journal saved as it was cleared")
  selection.dispatch(main)
  assert.deepEqual(rig.encoded(), SWAP, 'the main view swaps its mask back, no cut')
  assert.deepEqual(await drawAside(), SWAP, 'and the aside')
  assert.deepEqual(await drawAside(), [], 'a mask in place runs nothing')
  // A pose parked moves the cut: the main view cuts again.
  selection.parkWorld(0, true)
  selection.dispatch(main)
  assert.ok(rig.encoded().includes('dagPrepare'))
  aside.dispose()
  assert.equal(regionsWanted(swap), 0, 'no view aside: no region asked')
})

test("a view's journal is believed only for a whole readback of the cut it asks", () => {
  const swap = createMaskSwap(),
    next = view(1),
    state = { residencyRevision: 0, worldRevision: 0 }
  // What the dispatches ask before a mask comes back from its journal (`dispatch.ts`, `aside.ts`).
  const standsFor = (uniforms: typeof next, revisions: typeof state) =>
    !!swap.cuts[MAIN_VIEW - 1]?.whole && sameCut(swap, MAIN_VIEW, uniforms, revisions)
  const serial = noteCut(swap, MAIN_VIEW, { uniforms: next, residency: 0, world: 0 })
  assert.equal(standsFor(next, state), false, 'not read back whole yet')
  noteWhole(swap, MAIN_VIEW, serial)
  assert.equal(standsFor(next, state), true, 'its cut, read back whole')
  assert.equal(standsFor(view(2), state), false, 'another view')
  assert.equal(standsFor(next, { ...state, worldRevision: 1 }), false, 'poses')
  assert.equal(standsFor(next, { ...state, residencyRevision: 1 }), false)
  assert.equal(restorable(swap, MAIN_VIEW), false, 'no region holds it')
})

test('a region a view saves to holds its cut once; views aside reuse the regions let go', () => {
  const swap = createMaskSwap()
  const side = takeAsideView(swap)
  assert.equal(regionsWanted(swap), 2)
  assert.equal(saveRegionFor(swap, side), REGION_NONE, 'no mask to save yet')
  noteCut(swap, MAIN_VIEW, { uniforms: view(1), residency: 0, world: 0 })
  assert.equal(saveRegionFor(swap, side), REGION_NONE, 'no region made yet')
  swap.regions = 2
  swap.saved = [-1, -1]
  assert.equal(saveRegionFor(swap, side), 0, "the main view's journal to its region")
  assert.equal(saveRegionFor(swap, side), REGION_NONE, 'already there: saved once')
  assert.equal(restorable(swap, MAIN_VIEW), true)
  const third = takeAsideView(swap)
  assert.equal(regionsWanted(swap), 3)
  releaseAsideView(swap, side)
  assert.equal(takeAsideView(swap), side, 'a view let go gives its region to the next')
  releaseAsideView(swap, third)
  assert.equal(regionsWanted(swap), 2)
})

test('a recut leaves the main cut and its readback standing on no residency', () => {
  const swap = createMaskSwap(),
    state = createDagRuntimeState(),
    next = view(1)
  noteCut(swap, MAIN_VIEW, { uniforms: next, residency: 0, world: 0 })
  state.readback = { uniforms: next, residency: 0, world: 0 }
  assert.ok(sameCut(swap, MAIN_VIEW, next, state), 'the cut submitted is the one asked')
  assert.ok(stampMatches(state.readback, next, state), 'and so is the readback')
  recutMain(swap, state)
  assert.equal(sameCut(swap, MAIN_VIEW, next, state), false, 'the next dispatch cuts again')
  assert.equal(stampMatches(state.readback, next, state), false, 'and reads back again')
})

// #1483: a capture waits on its view's flush between two images (`captureAside.ts`). Its first
// image asks its region and cuts nothing: a flush that did not wait for the region drew 64 images
// on held tables and gave up (`SURFACE_GPU_COVERAGE_INCOMPLETE`).
test("a view aside's flush waits for the region its first image asked: its next image cuts", async () => {
  const rig = await differenceRig(64)
  const { selection, resources } = rig
  const aside = selection.aside()
  const side = view(4)
  const held = resources.device.createCommandEncoder()
  assert.equal(aside.dispatch(side, held), undefined, 'no cut before its region is made')
  await aside.flush()
  assert.equal(resources.swap.regions, 2, 'the regions made once its flush resolves')
  rig.cutNext({ asked: [], drawn: [4, 5] })
  const encoder = resources.device.createCommandEncoder()
  const settle = aside.dispatch(side, encoder)
  resources.device.queue.submit([encoder.finish()])
  settle?.(true)
  await aside.flush()
  assert.ok(rig.encoded().includes('dagPrepare'), 'the view aside cuts')
  assert.ok(aside.peek(), 'and reads its cut back')
  aside.dispose()
})
