// The shadow pool's free pages (`freePagesWgsl.ts`): the shipped pool sort — its three stages,
// workgroup by workgroup — run over a made-up pool, then the grant's pops. A page wanted this
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
import { POOL_SORT_WORDS } from '../gpu/pool/sort.ts'

const CODE = vsmPhysicalPageKernels(vsmLayout({ fullMapCapacity: 7 })).poolCount.code
const LANES = 256
const HOST = ['poolSlotCount', 'poolSlotAge', 'poolSlotTier', 'poolInUse', 'poolBurst']
const WORDS = ['poolCountAdd', 'poolCountLoad', 'poolCountStore', 'poolPlaced', 'poolEmit']
const FREE = ['pmPop', 'pmFreeCount', 'pmFreeAt']

type Page = { flags: number; lastWantedStamp: number; mapId: number; mipLevel: number }
type Run = {
  poolCount: (id: number[], n: number[], lane: number) => void
  poolPlace: () => void
  poolScatter: (id: number[], n: number[]) => void
  pmPop: () => number
  pmFreeCount: () => number
}
const BARRIER = Symbol('barrier')

/** The pages `pmPop` hands out after one sort of `pages` at `frame`, in order, and the free count
 *  the feedback reads before them. */
function popAll(pages: Page[], frame: number, mapLevels: number[]) {
  const freePages = new Array<number>(POOL_SORT_WORDS + 1 + pages.length).fill(0)
  const poolLocal = new Array<number>(POOL_RANKS).fill(0)
  const scope = {
    vsm: { poolPages: pages.length, frameStamp: frame },
    vsmPoolPageInfo: pages,
    vsmProjectionData: mapLevels.map((mapLevel) => ({ mapLevel })),
    vsmFreePages: freePages,
    poolLocal,
    atomicSub: (p: { get(): number; set(v: number): void }, v: number) => {
      const old = p.get()
      p.set(old - v)
      return old
    },
    bitcast_i32: (x: number) => x | 0,
  }
  const names = ['poolCount', 'poolPlace', 'poolScatter', 'poolSlotRank', 'poolRank', 'flatIndex']
  const all = [...names, 'bitLength', ...HOST, ...WORDS, ...FREE]
  // The count's halves either side of its barrier: every lane's local count, then every lane's
  // flush of the group's counts, a lane counting nothing.
  const counting = shaderRun<Run>(CODE, all, {
    ...scope,
    workgroupBarrier() {
      throw BARRIER
    },
  })
  const flushing = shaderRun<Run>(
    CODE,
    all.filter((name) => name !== 'poolSlotRank'),
    { ...scope, workgroupBarrier() {}, poolSlotRank: () => POOL_RANKS },
  )
  const groups = Math.ceil(pages.length / LANES),
    n = [groups, 1, 1]
  for (let g = 0; g < groups; g++) {
    poolLocal.fill(0)
    for (let lane = 0; lane < LANES; lane++)
      try {
        counting.poolCount([g * LANES + lane, 0, 0], n, lane)
      } catch (stop) {
        if (stop !== BARRIER) throw stop
      }
    for (let lane = 0; lane < LANES; lane++) flushing.poolCount([g * LANES + lane, 0, 0], n, lane)
  }
  counting.poolPlace()
  for (let j = 0; j < groups * LANES; j++) counting.poolScatter([j, 0, 0], n)
  const free = counting.pmFreeCount(),
    popped: number[] = []
  for (let p; (p = counting.pmPop()) >= 0;) popped.push(p)
  return { free, popped, counts: freePages.slice(0, POOL_RANKS) }
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
