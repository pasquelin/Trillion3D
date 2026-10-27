// The page management of the prefiltered distant shadow (`filterablePropagateWgsl.ts`,
// `physicalPagesWgsl.ts`): the requests of a sun's level passed on to its coarser levels with the
// receiver cover's quarter folded a mip a hop, and the selection of the pages the filters process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { vsmFilterableKernels } from './filterableWgsl.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { VSM_MAP_PREFILTERED_DISTANT } from './prefilteredConstants.ts'
import { ON } from './prefiltered.fixture.ts'

const PROPAGATE = vsmFilterableKernels(ON).propagateFilterable.code
const C = wgslConstants(PROPAGATE)
const ASKED = C.VSM_PAGE_SECONDARY | C.VSM_PAGE_FINE
const SELECT = vsmPhysicalPageKernels(ON, { stats: false }).selectMerges.code
const K = wgslConstants(SELECT)

/** A word table that tells the keys it was or-ed at, in order. */
const words = () => {
  const held = new Map<string, number>(),
    ored: string[] = []
  return {
    held,
    ored,
    load: (key: string) => held.get(key) ?? 0,
    or(key: string, value: number) {
      const before = held.get(key) ?? 0
      held.set(key, before | value)
      ored.push(key)
      return before
    },
  }
}

/** The walk of a sun's three levels, ids 10 to 12, from page (40, 41) of the first: the tables of
 *  requests and receiver covers stand in, a page at `id * 10000 + x` in a row `y`, the folds of the
 *  cover's masks are told apart by what they add. */
function walk(useCover: boolean) {
  const [requests, covers] = [words(), words()]
  const records: Record<number, object> = {
    10: { cornerSteps: [1, 1], levelsLeft: 3, useCover },
    11: { cornerSteps: [2, 3] },
    12: { cornerSteps: [0, 1] },
  }
  let gathered = 0xf0f
  const run = shaderRun<{ pmPropagateFilterable(...a: unknown[]): void }>(
    PROPAGATE,
    ['pmPropagateFilterable'],
    {
      ...C,
      vsmTableEntryOf: (h: { id: number }, _mip: number, page: number[]) => ({
        tableXY: [h.id * 10000 + page[0], page[1]],
      }),
      vsmTableIndex: (t: number[]) => t.join(':'),
      vsmPageRequestsLoad: requests.load,
      vsmPageRequestsOr: requests.or,
      vsmHandleOffset: (h: { id: number }, offset: number) => ({ id: h.id + offset }),
      vsmProjectionOf: (h: { id: number }) => records[h.id],
      vsmGatherCover: () => [gathered, 0, 0, 0],
      vsmFoldMask8x8: (mask: number[]) => mask[0],
      vsmFoldMask4x4: (mask: number, odd: number[]) => mask + 1 + 2 * odd[0] + 4 * odd[1],
      vsmCoverInBounds: () => true,
      vsmCoverIndex: (cell: number[], mip: number) => `${cell.join(':')}:${mip}`,
      vsmReceiverCoverOr: covers.or,
    },
  )
  const from = (x: number, y: number) =>
    run.pmPropagateFilterable({ walkStart: [x, y], walkStep: 128, handle: { id: 10 } }, records[10])
  const ask = (x: number, y: number) =>
    requests.held.set(
      `${100000 + x}:${y}`,
      C.VSM_PAGE_WANTED | C.VSM_PAGE_PRIMARY | C.VSM_PAGE_FINE,
    )
  return { from, ask, requests, covers, mask: (value: number) => (gathered = value) }
}

test('a requested page asks the page that covers it in each coarser level, secondary and fine', () => {
  const { from, ask, requests } = walk(false)
  // Page (40, 41) of level 0, its corner at (1, 1) quarters: page (8, 9) from the clipmap's corner;
  // level 1 at (2, 3) puts it at (136, 201) half pages, page (68, 100); level 2 at (0, 1) at (2, 34).
  ask(40, 41)
  from(40, 41)
  assert.deepEqual(requests.ored, ['110068:100', '120002:34'])
  assert.deepEqual(
    [requests.held.get('110068:100'), requests.held.get('120002:34')],
    [ASKED, ASKED],
  )
  // The page asked itself keeps its own bits: nothing is or-ed into it.
  assert.equal(
    requests.held.get('100040:41'),
    C.VSM_PAGE_WANTED | C.VSM_PAGE_PRIMARY | C.VSM_PAGE_FINE,
  )
  // The same page again: level 1 held the request, the walk ends there, another page carries it on.
  from(40, 41)
  assert.deepEqual(requests.ored.slice(2), ['110068:100'])
  // A page nobody asked passes nothing on.
  from(50, 50)
  assert.equal(requests.ored.length, 3)
})

test('the receiver cover’s quarter of the page goes down a mip a hop, and a changed mask carries the walk on', () => {
  const { from, ask, requests, covers, mask } = walk(true)
  ask(40, 41)
  from(40, 41)
  // The gathered mask folded for the first level's quarter, at the cell the page's odd half selects;
  // folded again a mip down for the second's.
  assert.deepEqual(covers.ored, ['220136:201:0', '240004:68:0'])
  assert.deepEqual(
    [covers.held.get('220136:201:0'), covers.held.get('240004:68:0')],
    [0xf0f, 0xf14],
  )
  // Nothing changed, request or mask: the walk ends at the first level.
  from(40, 41)
  assert.deepEqual([requests.ored.length, covers.ored.length], [3, 3])
  // The request unchanged but a mask grown: the walk goes on to the second level.
  mask(0xfff)
  from(40, 41)
  assert.deepEqual(covers.ored.slice(3), ['220136:201:0', '240004:68:0'])
  assert.equal(covers.held.get('240004:68:0'), 0xf14 | 0x1004)
})

/** The selection over `pages`, a pool of six: the filtered pages and arguments it lists, the pages to
 *  merge. */
function selected(pages: { flags: number; mapId: number }[]) {
  const args = new Array<number>(12).fill(0),
    lists = new Array<number>(2 * pages.length).fill(-1),
    clearArgs = [16, 0, 1, 0],
    toClear: number[] = []
  const select = shaderRun<{ vsmSelectMerges(id: number[]): void }>(SELECT, ['vsmSelectMerges'], {
    ...K,
    vsm: { poolPages: pages.length },
    vsmPoolPageInfo: pages,
    vsmHandleFromId: (id: number) => ({ id }),
    vsmProjectionOf: (h: { id: number }) => ({
      flags: h.id === 1 ? VSM_MAP_PREFILTERED_DISTANT : 0,
    }),
    vsmFilterableArgs: args,
    vsmFilterablePagesStore: (i: number, value: number) => void (lists[i] = value),
    vsmClearArgs: clearArgs,
    vsmPagesToClearStore: (slot: number, page: number) => void (toClear[slot] = page),
  })
  for (let k = 0; k < pages.length + 2; k++) select.vsmSelectMerges([k, 0, 0])
  return { args, lists, clearArgs, toClear }
}

test('the selection lists a page held, seen, secondary and of a prefiltered map, in the lists and the arguments', () => {
  const [W, S, U, D] = [
    K.VSM_PAGE_WANTED,
    K.VSM_PAGE_SECONDARY,
    K.VSM_META_UNSEEN,
    K.VSM_META_STATIC_DRAWN,
  ]
  const { args, lists, clearArgs, toClear } = selected([
    { flags: W | S, mapId: 1 }, // listed
    { flags: W | S | U, mapId: 1 }, // its light unseen
    { flags: W | S, mapId: 2 }, // a map of no prefiltered shadow
    { flags: W, mapId: 1 }, // no finer level falls back on it
    { flags: W | S | D, mapId: 1 }, // listed, and its static layer to merge
    { flags: 0, mapId: 1 }, // no page
  ])
  const set = (index: number) => K.VSM_FILTER_ARGS_SET_WORDS * index
  // The separable passes and the merge down: a page each in y; the borders: the pages in x.
  assert.equal(args[set(K.VSM_FILTER_ARGS_SEPARABLE) + 1], 2)
  assert.equal(args[set(K.VSM_FILTER_ARGS_MERGE) + 1], 2)
  assert.equal(args[set(K.VSM_FILTER_ARGS_BORDER)], 2)
  const at = (list: number) => lists.slice(list * 6, list * 6 + 2)
  assert.deepEqual(at(K.VSM_FILTER_LIST_SEPARABLE), [0, 4])
  assert.deepEqual(at(K.VSM_FILTER_LIST_FILTERABLE), [0, 4])
  // The pages to merge are the ones they always were: the fifth alone has a static layer drawn.
  assert.deepEqual([clearArgs[1], toClear], [1, [4]])
})
