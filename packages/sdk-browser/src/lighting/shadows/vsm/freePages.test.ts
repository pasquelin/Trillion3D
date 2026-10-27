// The shadow pool's free pages (`freePagesWgsl.ts`): the shipped pool sort — its stages, workgroup
// by workgroup (`sortRun.fixture.ts`) — run over a made-up pool, then the grant's pops. A page wanted this
// frame is never taken; an empty page goes first; then the page wanted longest ago, frame by frame
// up to `LAST_STEP` frames, pages of one age in pool order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { mulberry32 } from '../../../../../math/src/sequence/random.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { vsmLayout } from './layout.ts'
import { POOL_RANKS } from '../../../gpu/sort/rank.ts'
import { POOL_SORT_WORDS, poolScratchWords } from '../../../gpu/sort/sortWords.ts'
import { runPoolSort } from '../../../gpu/sort/sortRun.fixture.ts'

/** The age of the last rank: pages wanted this many frames ago or more share it (`poolSlotRank`). */
const LAST_AGE = POOL_RANKS - 1

const CODE = vsmPhysicalPageKernels(
  vsmLayout({
    coverMode: 'suns',
    fullMapCapacity: 7,
  }),
).poolCount.code
/** The shadow pool's side of the sort: its ranks, its words and its free pages. */
const HOST = [
  ...['poolSlotRank', 'poolSlotCount', 'poolPage'],
  ...['poolBurst', 'poolPlaced', 'poolEmit', 'poolCountAdd', 'poolCountLoad'],
  ...['poolCountStore', 'poolScratchLoad', 'poolScratchStore', 'pmFreeCount'],
]

type Page = { flags: number; lastWantedStamp: number; mapId: number; mipLevel: number }
type Free = { pmPop: () => number; pmFreeCount: () => number }

/** The pages `pmPop` hands out after one sort of `pages` at `frame`, in order, and the free count
 *  the feedback reads before them. */
function popAll(pages: Page[], frame: number, mapLevels: number[], seed = 1, lru = true) {
  // The sort's words, the free count and the requests it fell short of, the pages, the scratch.
  const words = POOL_SORT_WORDS + 2 + pages.length + poolScratchWords(pages.length, pages.length)
  const freePages = new Array<number>(words).fill(0)
  const scope = {
    vsm: { poolPages: pages.length, frameStamp: frame },
    vsmPm: { lruAllocation: lru ? 1 : 0 },
    vsmPoolPageInfo: pages,
    vsmProjectionData: mapLevels.map((mapLevel) => ({ mapLevel })),
    vsmFreePages: freePages,
    atomicSub: (p: { get(): number; set(v: number): void }, v: number) => {
      const old = p.get()
      p.set(old - v)
      return old
    },
    bitcast_i32: (x: number) => x | 0,
  }
  runPoolSort(CODE, HOST, scope, pages.length, mulberry32(seed))
  const free = shaderRun<Free>(CODE, ['pmPop', 'pmFreeCount'], scope)
  const count = free.pmFreeCount(),
    popped: number[] = []
  for (let p; (p = free.pmPop()) >= 0;) popped.push(p)
  return { free: count, popped, counts: freePages.slice(0, POOL_RANKS) }
}

test('the free pages: the empty ones, then the least recently wanted, pages of one age in pool order; none wanted now', () => {
  const rand = mulberry32(27),
    frame = 5000
  const mapLevels = [0, 0, 9, 10, 11, 14]
  for (const count of [600, 300, 1024]) {
    const pages: Page[] = Array.from({ length: count }, () => {
      const kind = rand()
      const age = kind < 0.2 ? 0 : 1 + Math.floor(rand() * (kind < 0.9 ? 1000 : 4000))
      return {
        flags: kind < 0.1 ? 0 : 1,
        lastWantedStamp: frame - age,
        mapId: Math.floor(rand() * mapLevels.length),
        mipLevel: Math.floor(rand() * 8),
      }
    })
    const empty = (p: number) => pages[p].flags === 0
    const wanted = pages.filter((p) => p.flags !== 0 && p.lastWantedStamp === frame).length
    const { free, popped, counts } = popAll(pages, frame, mapLevels)
    // The feedback's count: every page but those wanted now.
    assert.equal(free, count - wanted, `${count}: the free count`)
    assert.equal(popped.length, count - wanted, `${count}: every free page popped once`)
    assert.equal(new Set(popped).size, popped.length)
    for (const p of popped)
      assert.ok(empty(p) || pages[p].lastWantedStamp !== frame, `page ${p} is wanted now`)
    // The empty pages first, then never one again.
    const firstKept = popped.findIndex((p) => !empty(p))
    assert.ok(
      popped.slice(firstKept).every((p) => !empty(p)),
      `${count}: an empty page late`,
    )
    const kept = popped.slice(firstKept)
    for (let i = 1; i < kept.length; i++) {
      const [a, b] = [kept[i - 1], kept[i]]
      const [ageA, ageB] = [a, b].map((p) => Math.min(frame - pages[p].lastWantedStamp, LAST_AGE))
      assert.ok(ageA >= ageB, `${count}: the older first at ${i}`)
      if (ageA === ageB) assert.ok(a < b, `${count}: pool order at one age, at ${i}`)
    }
    // The counts zeroed for the next frame's sort.
    assert.ok(counts.every((c) => c === 0))
    // Its threads in another order, the same pages in the same order.
    assert.deepEqual(popAll(pages, frame, mapLevels, 2).popped, popped)
  }
})

test('a page wanted longer ago goes first, whatever its level; one age is told by no level', () => {
  const frame = 100
  // Ages 5 and 6 are two ranks: the older page goes first, though its level is the coarsest. The
  // three pages of age 5 go in pool order, the coarse one between the fine ones.
  const pages: Page[] = [
    { flags: 1, lastWantedStamp: frame - 5, mapId: 0, mipLevel: 0 },
    { flags: 1, lastWantedStamp: frame - 5, mapId: 0, mipLevel: 3 },
    { flags: 1, lastWantedStamp: frame - 5, mapId: 0, mipLevel: 0 },
    { flags: 1, lastWantedStamp: frame - 6, mapId: 0, mipLevel: 3 },
  ]
  assert.deepEqual(popAll(pages, frame, [0]).popped, [3, 0, 1, 2])
})

test('the ages up to LAST_AGE are told apart; older ones share the last rank', () => {
  const frame = 5000
  const ages = [3, 30, 31, 32, 500, 1, LAST_AGE - 1, 1000]
  const pages: Page[] = ages.map((age) => ({
    flags: 1,
    lastWantedStamp: frame - age,
    mapId: 0,
    mipLevel: 0,
  }))
  // Oldest first, frame by frame, far past the 31 frames and up to LAST_AGE - 1.
  assert.deepEqual(popAll(pages, frame, [0]).popped, [6, 7, 4, 3, 2, 1, 0, 5])
  // LAST_AGE frames and older share the last rank, taken in pool order, before every younger page.
  const old: Page[] = [LAST_AGE - 1, LAST_AGE + 300, LAST_AGE, LAST_AGE + 4000].map((age) => ({
    flags: 1,
    lastWantedStamp: frame - age,
    mapId: 0,
    mipLevel: 0,
  }))
  assert.deepEqual(popAll(old, frame, [0]).popped, [1, 2, 3, 0])
})

test('a page wanted last frame and not now may be taken; one wanted now never', () => {
  const frame = 100
  const pages: Page[] = [
    { flags: 1, lastWantedStamp: frame, mapId: 0, mipLevel: 0 },
    { flags: 1, lastWantedStamp: frame - 1, mapId: 0, mipLevel: 0 },
    { flags: 0, lastWantedStamp: frame, mapId: 0, mipLevel: 0 },
  ]
  assert.deepEqual(popAll(pages, frame, [0]).popped, [2, 1])
})

// Without the age order (`shadowCacheAllocateViaLru` off) the pages not wanted now go in the order of
// a list popped from its tail: the empty ones first, then the others from the end of the pool,
// whatever their age and level; one wanted now is never taken.
test('without the age order the empty pages go first, then the others from the last place of the pool', () => {
  const frame = 100
  const pages: Page[] = [
    { flags: 1, lastWantedStamp: frame - 90, mapId: 0, mipLevel: 6 },
    { flags: 1, lastWantedStamp: frame, mapId: 0, mipLevel: 0 },
    { flags: 1, lastWantedStamp: frame - 2, mapId: 0, mipLevel: 0 },
    { flags: 0, lastWantedStamp: frame, mapId: 0, mipLevel: 0 },
    { flags: 1, lastWantedStamp: frame - 9, mapId: 0, mipLevel: 2 },
  ]
  assert.deepEqual(popAll(pages, frame, [0], 1, true).popped, [3, 0, 4, 2])
  const { popped, free } = popAll(pages, frame, [0], 1, false)
  assert.equal(free, 4)
  assert.deepEqual(popped, [3, 4, 2, 0])
})
