// The update context's program assembles with the feedback bound beside the tables, the context and the shadow traces; a page
// the rays read at its finest level within the last two images updates at speed 4, whatever its distance and the frustum say.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { FEEDBACK_AT, FEEDBACK_HEADER_WORDS } from '../feedbackLayout.ts'
import {
  CONTEXT_ENTRIES,
  CONTEXT_FEEDBACK_BINDING,
  CONTEXT_PAGE_ARGS_BINDING,
  CONTEXT_WGSL,
  SPLICE_CONTEXT_BINDING,
  SPLICE_ENTRIES,
  SPLICE_WGSL,
} from './contextWgsl.ts'
import { LIGHTING_FLAG } from './layout.ts'
import { near } from './params.fixture.ts'

test('the program assembles and binds the rays’ feedback read-only, where the kernel lays it', () => {
  for (const entry of CONTEXT_ENTRIES) assertProgramAssembles(CONTEXT_WGSL, entry)
  assert.deepEqual(
    wgslBufferBindings(CONTEXT_WGSL).find(({ binding }) => binding === CONTEXT_FEEDBACK_BINDING),
    { binding: CONTEXT_FEEDBACK_BINDING, type: 'read-only-storage' },
  )
  const named = wgslConstants(CONTEXT_WGSL)
  assert.equal(named.FLAG_FEEDBACK, LIGHTING_FLAG.feedback)
  assert.equal(named.FEEDBACK_HI_RES, FEEDBACK_AT.lastUsedHiRes)
})

test('the pages are cut into tiles by a program that writes the context and leaves the dispatch arguments to a buffer of their own', () => {
  for (const entry of SPLICE_ENTRIES) assertProgramAssembles(SPLICE_WGSL, entry)
  const splice = wgslBufferBindings(SPLICE_WGSL)
  assert.deepEqual(
    splice.find(({ binding }) => binding === SPLICE_CONTEXT_BINDING),
    { binding: SPLICE_CONTEXT_BINDING, type: 'storage' },
  )
  assert.ok(!splice.some(({ binding }) => binding === CONTEXT_PAGE_ARGS_BINDING))
  assert.deepEqual(
    wgslBufferBindings(CONTEXT_WGSL).find(({ binding }) => binding === CONTEXT_PAGE_ARGS_BINDING),
    { binding: CONTEXT_PAGE_ARGS_BINDING, type: 'storage' },
  )
})

test('a splice workgroup takes its threads in Z order over a square of 8 × 8 tiles', () => {
  const { zOrderDecode } = shaderRun<{ zOrderDecode: (index: number) => number[] }>(
    SPLICE_WGSL,
    ['zOrderDecode'],
    { ...wgslConstants(SPLICE_WGSL) },
  )
  assert.deepEqual(zOrderDecode(0), [0, 0])
  assert.deepEqual(zOrderDecode(1), [1, 0])
  assert.deepEqual(zOrderDecode(2), [0, 1])
  assert.deepEqual(zOrderDecode(3), [1, 1])
  assert.deepEqual(zOrderDecode(4), [2, 0])
  assert.deepEqual(zOrderDecode(63), [7, 7])
})

/** A page's update speed (`updateSpeed`), run in JavaScript over the parameters and the feedback buffer it reads. */
function speedRun() {
  const lp = { flags: LIGHTING_FLAG.feedback as number, frame: 100, firstClipmapRcp: 0.001 }
  // The buffer's header names where its last-read part begins, after the header here; it holds the pages 0 to 7.
  const feedback = new Uint32Array(FEEDBACK_HEADER_WORDS + 8)
  feedback[FEEDBACK_AT.lastUsedHiRes] = FEEDBACK_HEADER_WORDS
  const run = shaderRun<{
    updateSpeed: (page: number, view: { distance: number; near: boolean }) => number
  }>(CONTEXT_WGSL, ['updateSpeed'], { ...wgslConstants(CONTEXT_WGSL), lp, feedback })
  return {
    lp,
    /** The speed of page `page` last read at its finest level at image `used`, with the page `far` centimetres from the eye. */
    speed(used: number, near = false, far = 1000, page = 0) {
      feedback.fill(0, FEEDBACK_HEADER_WORDS)
      feedback[FEEDBACK_HEADER_WORDS + page] = used
      return run.updateSpeed(page, { distance: far, near })
    },
  }
}

test('a page read at its finest level within the last two images updates at speed 4, one read later or earlier does not', () => {
  const { lp, speed } = speedRun()
  // The reference's rule: last + 2 >= frame and last <= frame.
  for (const used of [98, 99, 100])
    assert.equal(speed(used), 4, `read at ${used}, image ${lp.frame}`)
  assert.equal(speed(101), 0.5, 'read after the image: not the rule’s')
  assert.equal(speed(97), 0.5, 'read three images ago')
  assert.equal(speed(0), 0.5, 'never read')
  // Applied after the frustum's doubling, over it: 4 whatever it gave.
  assert.equal(speed(100, true), 4)
  assert.equal(speed(100, true, 0), 4)
  assert.equal(
    speed(97, true),
    1,
    'the doubling of a page near the frustum stays where the rule does not apply',
  )
})

test('the speed is the distance’s and the frustum’s where the feedback is off or the buffer holds no part for the page', () => {
  const { lp, speed } = speedRun()
  lp.flags = 0
  assert.equal(speed(100), 0.5)
  assert.equal(speed(100, true), 1)
  lp.flags = LIGHTING_FLAG.feedback
  // A page past the part the buffer holds was never read at its finest level.
  assert.equal(speed(100, false, 1000, 8), 0.5)
})

test("a page's view is the nearest eye's distance and near either frustum", () => {
  // A card facing +z at the origin, a page of the whole card; two eyes, the first far and in front, the second near and behind.
  const card = {
    origin: [0, 0, 0],
    axisX: [1, 0, 0],
    axisY: [0, 1, 0],
    axisZ: [0, 0, 1],
  }
  const lp = { flags: LIGHTING_FLAG.prioritizeFrustum as number, frustumDistance: 0 }
  const { viewOfPage } = shaderRun<{
    viewOfPage: (
      card: unknown,
      centre: number[],
      reach: number[],
      eye: number[],
      planes: number[][],
    ) => { distance: number; near: boolean }
  }>(CONTEXT_WGSL, ['viewOfPage'], { ...wgslConstants(CONTEXT_WGSL), lp })
  const box = [
    [0, 0, 0],
    [10, 10, 1],
  ] as const
  // Every plane's outward normal, 1 cm from the eye away from the box: the box is inside all of them, so near.
  const inside = Array.from({ length: 5 }, () => [0, 0, 1, -1000])
  const outsideOne = [[0, 0, 1, 1000], ...inside.slice(1)]
  const far = viewOfPage(card, box[0].slice(), box[1].slice(), [0, 0, 500], inside)
  assert.equal(far.near, true)
  near(far.distance, 499)
  assert.equal(
    viewOfPage(card, box[0].slice(), box[1].slice(), [0, 0, 500], outsideOne).near,
    false,
  )
})
