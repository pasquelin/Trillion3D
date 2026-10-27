// A page held but not asked this frame keeps the fine flag it was drawn with, so the invalidation
// finds it: a caster that moves while nobody asks the page is not missed when the page is asked
// again at the same detail and served from the cache. The keep rule (`vsmKeepPages`) run over a made-up pool.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { vsmLayout } from './layout.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'

const { code } = vsmPhysicalPageKernels(
  vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 }),
  { stats: false },
).keepPages
const K = wgslConstants(code)

/** The rule run on a pool of one page whose words are `flags` and whose last request was `age` frames ago, nobody asking it now:
 *  what it stores in the page's marks, and the words it is left with. */
function keptUnrequested(flags: number, age: number) {
  const marks: number[] = []
  const pool = [{ flags, mapId: 1, pageAddress: [0, 0], mipLevel: 0, lastWantedStamp: 100 - age }]
  shaderRun<{ vsmKeepPages: (index: { x: number }) => void }>(code, ['vsmKeepPages'], {
    vsm: { poolPages: 1, frameStamp: 100, pageKeepFrames: 10, deferredBudget: 0 },
    vsmPm: { hasPrevFrame: 1, skipDynamicInvalidation: 0 },
    vsmPoolPageInfo: pool,
    vsmHandleFromId: () => ({ id: 1 }),
    vsmTableEntryOf: () => ({ tableXY: [0, 0] }),
    vsmTableIndex: () => 0,
    vsmPageMarkIndex: () => 0,
    vsmPageRequestsLoad: () => 0,
    vsmProjectionOf: () => ({ lightUnseen: false }),
    vsmPageMarksStore: (_at: number, value: number) => void marks.push(value),
    vsmPageTableStore: () => {},
    vsmPackTableEntry: () => 0,
    vsmPoolPageOf: () => 0,
    vsmCount: () => {},
  }).vsmKeepPages({ x: 0 })
  return { marks, flags: pool[0].flags }
}

test('an unrequested page held within its age is stored wanted and fine as it was drawn, its words kept and marked unseen', () => {
  const drawn = K.VSM_PAGE_FINE | K.VSM_META_STATIC_STALE
  const kept = keptUnrequested(drawn, 3)
  assert.deepEqual(kept.marks, [K.VSM_PAGE_WANTED | K.VSM_PAGE_FINE])
  assert.equal(kept.flags, (drawn | K.VSM_META_UNSEEN) >>> 0, 'its words, stale bits included')
})

test('an unrequested page drawn coarse is stored wanted alone: no fine flag is made up', () => {
  const kept = keptUnrequested(K.VSM_META_DYNAMIC_STALE, 3)
  assert.deepEqual(kept.marks, [K.VSM_PAGE_WANTED])
})

test('a page unrequested for longer than the pool keeps pages is emptied: no mark is stored for it', () => {
  const kept = keptUnrequested(K.VSM_PAGE_FINE, 11)
  assert.deepEqual(kept.marks, [])
  assert.equal(kept.flags, 0)
})
