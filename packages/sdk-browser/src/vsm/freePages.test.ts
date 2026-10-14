// The shadow pool's free pages (`freePagesWgsl.ts`): the shipped pool sort — its stages, workgroup
// by workgroup (`sortRun.fixture.ts`) — run over a made-up pool, then the grant's pops. A page wanted this
// frame is never taken; an empty page goes first; then the page wanted longest ago by age step,
// the finer level first within a step — where the age order of before took the older page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { mulberry32 } from '../../../math/src/sequence/random.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { vsmLayout } from './layout.ts'
import { POOL_RANKS } from '../gpu/pool/rank.ts'
import { ageStep } from '../gpu/pool/rank.fixture.ts'
import { POOL_SORT_WORDS, poolScratchWords } from '../gpu/pool/sortWords.ts'
import { runPoolSort } from '../gpu/pool/sortRun.fixture.ts'

const CODE = vsmPhysicalPageKernels(vsmLayout({ fullMapCapacity: 7 })).poolCount.code
/** The shadow pool's side of the sort: its ranks, its words and its free pages. */
const HOST = [
  ...['poolSlotRank', 'poolRank', 'bitLength', 'poolSlotCount', 'poolSlotAge', 'poolSlotTier'],
  ...['poolInUse', 'poolBurst', 'poolPlaced', 'poolEmit', 'poolCountAdd', 'poolCountLoad'],
  ...['poolCountStore', 'poolScratchLoad', 'poolScratchStore', 'pmFreeCount', 'pmFreeAt'],
]

type Page = { flags: number; lastWantedStamp: number; mapId: number; mipLevel: number }
type Free = { pmPop: () => number; pmFreeCount: () => number }

/** The pages `pmPop` hands out after one sort of `pages` at `frame`, in order, and the free count
 *  the feedback reads before them. */
function popAll(pages: Page[], frame: number, mapLevels: number[], seed = 1) {
  const words = POOL_SORT_WORDS + 1 + pages.length + poolScratchWords(pages.length, pages.length)
  const freePages = new Array<number>(words).fill(0)
  const scope = {
    vsm: { poolPages: pages.length, frameStamp: frame },
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
  const free = shaderRun<Free>(CODE, ['pmPop', 'pmFreeCount', 'pmFreeAt'], scope)
  const count = free.pmFreeCount(),
    popped: number[] = []
  for (let p; (p = free.pmPop()) >= 0;) popped.push(p)
  return { free: count, popped, counts: freePages.slice(0, POOL_RANKS) }
}

test('the free pages: the empty ones, then by age step, the finer level first; none wanted now', () => {
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
    const tierOf = (p: number) => mapLevels[pages[p].mapId] + pages[p].mipLevel
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
      const [stepA, stepB] = [a, b].map((p) => ageStep(frame - pages[p].lastWantedStamp))
      assert.ok(stepA >= stepB, `${count}: the older step first at ${i}`)
      if (stepA === stepB) assert.ok(tierOf(a) <= tierOf(b), `${count}: the finer first at ${i}`)
    }
    // The counts zeroed for the next frame's sort.
    assert.ok(counts.every((c) => c === 0))
    // Its threads in another order, the same pages in the same order.
    assert.deepEqual(popAll(pages, frame, mapLevels, 2).popped, popped)
  }
})

test('within an age step the finer page goes first, though the coarser one is older', () => {
  const frame = 100
  // Ages 5 and 6 share a step (both three bits): the age order of before took the older, coarse
  // page; the pool rank takes the finer one.
  const pages: Page[] = [
    { flags: 1, lastWantedStamp: frame - 6, mapId: 0, mipLevel: 3 },
    { flags: 1, lastWantedStamp: frame - 5, mapId: 0, mipLevel: 0 },
  ]
  assert.deepEqual(popAll(pages, frame, [0]).popped, [1, 0])
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
