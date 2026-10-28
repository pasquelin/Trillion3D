// The shadow pool's page lists (`freePagesWgsl.ts`) against their CPU twin over many frames (`freePages.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { VSM_PAGE_LISTS } from './constants.ts'
import { vsmLayout } from './layout.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { gpuPool, runFrames } from './freePages.fixture.ts'

test('the page lists follow their description over many frames: order of allocation, counts', () => {
  for (const [pages, seed] of [
    [64, 1],
    [37, 2],
    [200, 3],
  ] as const) {
    runFrames(pages, 60, seed, true).forEach(({ gpu, twin }, frame) =>
      assert.deepEqual(gpu, twin, `${pages} pages, frame ${frame + 1}`),
    )
  }
})

test('the first frame has no previous order: the last page of the pool is taken first', () => {
  const outcome = gpuPool(16).frame(1, new Set(), 3, { hasPrevFrame: false, lruAllocation: true })
  assert.deepEqual(
    outcome.available,
    Array.from({ length: 16 }, (_, p) => p),
  )
  assert.deepEqual(outcome.popped, [15, 14, 13])
})

test('the pages left unrequested longest are taken after the empty ones: the LRU list leads', () => {
  const pool = gpuPool(8)
  // Frame 1: every page is empty; four requests take pages 7, 6, 5, 4.
  const first = pool.frame(1, new Set(), 4, { hasPrevFrame: false, lruAllocation: true })
  assert.deepEqual(first.popped, [7, 6, 5, 4])
  // The next order: the four taken, then the four left (0 to 3) in their order.
  assert.deepEqual(first.requested, [7, 6, 5, 4, 0, 1, 2, 3])
  // Frame 2: pages 4 and 6 asked again, none else: the order leads with them, the others follow.
  const second = pool.frame(2, new Set([4, 6]), 0, { hasPrevFrame: true, lruAllocation: true })
  assert.deepEqual(second.requested, [6, 4, 7, 5, 0, 1, 2, 3])
  // Frame 3: nothing asked, three requests take the empty pages, the last first.
  const third = pool.frame(3, new Set(), 3, { hasPrevFrame: true, lruAllocation: true })
  assert.deepEqual(third.popped, [3, 2, 1])
  // Frame 4: two requests take the last empty page, then the page unrequested longest.
  const fourth = pool.frame(4, new Set(), 2, { hasPrevFrame: true, lruAllocation: true })
  assert.deepEqual(fourth.popped, [0, 5])
})

test('without the age order a request takes the last place of the pool', () => {
  const outcomes = runFrames(48, 40, 11, false)
  outcomes.forEach(({ gpu, twin }, frame) => assert.deepEqual(gpu, twin, `frame ${frame + 1}`))
  const pool = gpuPool(8)
  pool.frame(1, new Set(), 8, { hasPrevFrame: false, lruAllocation: false })
  // All taken in frame 1; pages 0 and 5 asked in frame 2: the others, in pool order, are available.
  const next = pool.frame(2, new Set([0, 5]), 0, { hasPrevFrame: true, lruAllocation: false })
  assert.deepEqual(next.available, [1, 2, 3, 4, 6, 7])
})

test('a request past the available pages falls short: the count goes below zero, no page lost', () => {
  const pool = gpuPool(8)
  const outcome = pool.frame(1, new Set(), 11, { hasPrevFrame: false, lruAllocation: true })
  assert.equal(outcome.free, 8 - 11)
  assert.equal(outcome.popped.length, 8)
  assert.deepEqual(
    [...outcome.requested].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7],
  )
  assert.deepEqual(outcome.counts, [8, 0, 0, 8])
})

test('whatever the order of the threads, the requested list ends the frame whole, each page once', () => {
  runFrames(90, 50, 5, true, true).forEach(({ gpu: outcome }, frame) => {
    assert.equal(outcome.requested.length, 90, `frame ${frame + 1}`)
    assert.equal(new Set(outcome.requested).size, 90, `frame ${frame + 1}: a page twice`)
    assert.deepEqual(outcome.counts, [90, 0, 0, 90])
  })
})

test('a previous order left short of the pool is not used: every page is emptied once, none given twice', () => {
  const pages = 24
  const pool = gpuPool(pages)
  const options = { hasPrevFrame: true, lruAllocation: true }
  pool.frame(1, new Set(), 10, { ...options, hasPrevFrame: false })
  pool.frame(2, new Set([1, 2, 3]), 4, options)
  const outcome = pool.frame(3, new Set([1, 2, 3]), 0, { ...options, partialPrev: true })
  assert.deepEqual(
    outcome.available.slice().sort((a, b) => a - b),
    Array.from({ length: pages }, (_, p) => p),
  )
  assert.equal(new Set(outcome.requested).size, pages, 'a page twice')
  assert.deepEqual(outcome.counts, [pages, 0, 0, pages])
})

test('a push onto a full list leaves its count at the pool’s, and a pop takes only pages', () => {
  const pages = 4
  const code = vsmPhysicalPageKernels(vsmLayout({ coverMode: 'suns', fullMapCapacity: 7 }))
    .appendCopy.code
  const K = wgslConstants(code)
  const words = new Array<number>(VSM_PAGE_LISTS * (pages + 1)).fill(0)
  const lists = shaderRun<{
    pmPush(list: number, page: number): void
    pmPop(list: number): number
    pmListCount(list: number): number
  }>(code, ['pmPush', 'pmPop', 'pmListCount'], {
    vsm: { poolPages: pages },
    vsmFreePages: words,
    atomicSub: (p: { get(): number; set(v: number): void }, v: number) => {
      const old = p.get()
      p.set((old - v) >>> 0)
      return old
    },
    bitcast_i32: (x: number) => x | 0,
    bitcast_u32: (x: number) => x >>> 0,
  })
  const list = K.PM_LIST_AVAILABLE!
  for (let page = 0; page < pages + 2; page++) lists.pmPush(list, page)
  assert.equal(lists.pmListCount(list), pages, 'the count stops at the pool')
  assert.equal(words[(list + 1) * (pages + 1)], 0, 'the next list’s first word is untouched')
  const popped = Array.from({ length: pages + 1 }, () => lists.pmPop(list))
  assert.deepEqual(popped, [3, 2, 1, 0, -1], 'only pages, then none')
})
