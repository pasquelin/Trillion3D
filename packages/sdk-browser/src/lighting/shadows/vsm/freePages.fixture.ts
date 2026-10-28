// The shadow pool's page lists (`freePagesWgsl.ts`), as `freePages.test.ts` runs them: the shipped keep rule and
// list functions run over a made-up pool for many frames, beside a CPU twin of the lists written from their description (LRU,
// available, empty, requested). A page asked this frame leaves the LRU list for the requested one, a
// page with no word for the empty one; the LRU list left, packed in order, then the empty pages,
// make the available list, whose end a request takes; the requested list, grown by the pages taken
// and the pages left, is the next frame's LRU order.
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { mulberry32 } from '../../../../../math/src/sequence/random.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { vsmLayout } from './layout.ts'
import { VSM_PAGE_LISTS } from './constants.ts'

const KERNELS = vsmPhysicalPageKernels(vsmLayout({ coverMode: 'suns', fullMapCapacity: 7 }))
const KEEP_CODE = KERNELS.keepPages.code
const LISTS_CODE = KERNELS.appendCopy.code
const K = wgslConstants(KEEP_CODE)
const KEEP_FRAMES = 6
/** The map id of the pages of a light that is not seen. */
const UNSEEN_MAP = 2

type Page = {
  flags: number
  lastWantedStamp: number
  mapId: number
  mipLevel: number
  pageAddress: number[]
}
type Lists = {
  vsmInitPageLists: () => void
  pmPackKept: (g: number) => number
  pmPackPlace: (g: number, cursor: number, taken: number) => void
  pmListSetCount: (list: number, count: number) => void
  pmListCount: (list: number) => number
  pmListItem: (list: number, k: number) => number
  pmAppendItem: (input: number, output: number, thread: number) => void
  pmAppendCounts: (input: number, output: number) => void
  pmPop: (list: number) => number
  pmPush: (list: number, page: number) => void
  pmFreeCount: () => number
}

/** What a frame leaves: the available list before the grant, the pages the requests took, in order,
 *  the free count the feedback reads, the requested list at the end and every list's count. */
type Outcome = {
  available: number[]
  popped: number[]
  free: number
  requested: number[]
  counts: number[]
}

const unsigned = (x: number) => x >>> 0
const atomicSub = (p: { get(): number; set(v: number): void }, v: number) => {
  const old = p.get()
  p.set(unsigned(old - v))
  return old
}

/** The pool on the GPU side: two buffers of lists taking turns, the pages' words, and the frame run
 *  as its passes go (`encodeVsmPageMapping`): the lists reset, the keep rule a thread an entry, the LRU
 *  list packed, the empty pages appended, the grant's pops, the feedback, the available pages appended. */
export function gpuPool(pages: number) {
  const words = VSM_PAGE_LISTS * (pages + 1)
  const sets = [new Array<number>(words).fill(0), new Array<number>(words).fill(0)]
  const info: Page[] = Array.from({ length: pages }, (_, p) => ({
    flags: 0,
    lastWantedStamp: 0,
    mapId: p % 7 === 3 ? UNSEEN_MAP : 1,
    mipLevel: 0,
    pageAddress: [p, 0],
  }))
  let parity = 0
  return {
    info,
    frame(
      stamp: number,
      requested: ReadonlySet<number>,
      grants: number,
      options: {
        hasPrevFrame: boolean
        lruAllocation: boolean
        threads?: number[]
        /** The previous frame's requested list left short of the pool: a pass of its lists did not run. */
        partialPrev?: boolean
      },
    ): Outcome {
      const [lists, prev] = [sets[parity], sets[parity ^ 1]]
      const vsm = {
        poolPages: pages,
        frameStamp: stamp,
        pageKeepFrames: KEEP_FRAMES,
        deferredBudget: 0,
      }
      if (options.partialPrev) prev[K.PM_LIST_REQUESTED! * (pages + 1) + pages] = pages - 1
      const shared = {
        ...{ vsm, vsmFreePages: lists, atomicSub },
        ...{ bitcast_i32: (x: number) => x | 0, bitcast_u32: unsigned },
      }
      const gpu = shaderRun<Lists>(
        LISTS_CODE,
        [
          ...['vsmInitPageLists', 'pmPackKept', 'pmPackPlace', 'pmListSetCount', 'pmListCount'],
          ...['pmListItem', 'pmAppendItem', 'pmAppendCounts', 'pmPop', 'pmPush', 'pmFreeCount'],
        ],
        shared,
      )
      const keep = shaderRun<{ vsmKeepPages: (index: { x: number }) => void }>(
        KEEP_CODE,
        ['vsmKeepPages'],
        {
          ...shared,
          vsmPm: {
            hasPrevFrame: options.hasPrevFrame ? 1 : 0,
            lruAllocation: options.lruAllocation ? 1 : 0,
            skipDynamicInvalidation: 0,
          },
          vsmPrevFreePages: prev,
          vsmPoolPageInfo: info,
          vsmHandleFromId: (id: number) => ({ id }),
          vsmTableEntryOf: (_handle: unknown, _mip: number, address: number[]) => ({
            tableXY: address,
          }),
          vsmTableIndex: (xy: number[]) => xy[0],
          vsmPageMarkIndex: () => 0,
          vsmPageRequestsLoad: (index: number) => (requested.has(index) ? 1 : 0),
          vsmProjectionOf: (handle: { id: number }) => ({
            lightUnseen: handle.id === UNSEEN_MAP,
            distant: false,
            coarseDynamicCached: false,
            useCover: false,
            uncached: false,
          }),
          vsmPageMarksStore: () => {},
          vsmPageTableStore: () => {},
          vsmPackTableEntry: () => 0,
          vsmPoolPageOf: () => 0,
          vsmCount: () => {},
        },
      )
      gpu.vsmInitPageLists()
      for (const thread of options.threads ?? Array.from({ length: pages }, (_, i) => i))
        keep.vsmKeepPages({ x: thread })
      // The LRU list packed: the exclusive prefix of what the keep rule left in (`vsmPackAvailable`).
      let cursor = 0
      for (let g = 0; g < pages; g++) {
        const size = gpu.pmPackKept(g)
        gpu.pmPackPlace(g, cursor, size)
        cursor += size
      }
      gpu.pmListSetCount(K.PM_LIST_AVAILABLE, cursor)
      for (let thread = 0; thread < pages; thread++)
        gpu.pmAppendItem(K.PM_LIST_EMPTY, K.PM_LIST_AVAILABLE, thread)
      gpu.pmAppendCounts(K.PM_LIST_EMPTY, K.PM_LIST_AVAILABLE)
      const available = Array.from({ length: gpu.pmListCount(K.PM_LIST_AVAILABLE) }, (_, k) =>
        gpu.pmListItem(K.PM_LIST_AVAILABLE, k),
      )
      // The grant's pops: a page taken is pushed on the requested list and holds a new map.
      const popped: number[] = []
      for (let r = 0; r < grants; r++) {
        const page = gpu.pmPop(K.PM_LIST_AVAILABLE)
        if (page < 0) continue
        gpu.pmPush(K.PM_LIST_REQUESTED, page)
        info[page] = {
          ...{ ...info[page], flags: 1, lastWantedStamp: stamp },
          ...{ mapId: 1, pageAddress: [page, 0] },
        }
        popped.push(page)
      }
      const free = gpu.pmFreeCount()
      for (let thread = 0; thread < pages; thread++)
        gpu.pmAppendItem(K.PM_LIST_AVAILABLE, K.PM_LIST_REQUESTED, thread)
      gpu.pmAppendCounts(K.PM_LIST_AVAILABLE, K.PM_LIST_REQUESTED)
      parity ^= 1
      const counts = Array.from({ length: VSM_PAGE_LISTS }, (_, l) => gpu.pmListCount(l))
      const requestedList = Array.from({ length: counts[K.PM_LIST_REQUESTED] }, (_, k) =>
        gpu.pmListItem(K.PM_LIST_REQUESTED, k),
      )
      return { available, popped, free, requested: requestedList, counts }
    },
  }
}

/** The same pool as its description gives it, on plain arrays: each page of last frame's order is
 *  asked (and goes to the requested list), emptied (to the empty list) or left in the LRU list in its
 *  place; the available list is the pages left, then the empty ones; a request takes its last page. */
function twinPool(pages: number) {
  const info = Array.from({ length: pages }, (_, p) => ({
    flags: 0,
    stamp: 0,
    unseen: p % 7 === 3,
  }))
  let order = Array.from({ length: pages }, (_, p) => p)
  return {
    info,
    frame(
      stamp: number,
      requested: ReadonlySet<number>,
      grants: number,
      options: { hasPrevFrame: boolean; lruAllocation: boolean },
    ): Outcome {
      const entries = options.hasPrevFrame && options.lruAllocation ? order : order.map((_, i) => i)
      const lru: number[] = [],
        asked: number[] = [],
        empty: number[] = []
      for (const page of entries) {
        const held = options.hasPrevFrame && info[page].flags !== 0
        const wanted = held && requested.has(page)
        const age = stamp - info[page].stamp
        if (held && wanted && !info[page].unseen) {
          info[page].stamp = stamp
          asked.push(page)
        } else if (held && (wanted || info[page].unseen || age <= KEEP_FRAMES)) lru.push(page)
        else {
          info[page].flags = 0
          empty.push(page)
        }
      }
      const available = [...lru, ...empty]
      const listed = [...available]
      const popped: number[] = []
      const requestedList = [...asked]
      for (let r = 0; r < grants; r++) {
        const page = available.pop()
        if (page === undefined) continue
        requestedList.push(page)
        info[page] = { flags: 1, stamp, unseen: false }
        popped.push(page)
      }
      const free = listed.length - grants
      requestedList.push(...available)
      order = requestedList
      return {
        available: listed,
        popped,
        free,
        requested: requestedList,
        counts: [pages, 0, 0, pages],
      }
    },
  }
}

/** Frames of a pool of `pages`: the pages asked at random among those holding a map, and some
 *  requests for new pages. */
export function runFrames(
  pages: number,
  frames: number,
  seed: number,
  lruAllocation: boolean,
  shuffled = false,
) {
  const random = mulberry32(seed),
    order = mulberry32(seed + 1000)
  const [gpu, twin] = [gpuPool(pages), twinPool(pages)]
  const outcomes: { gpu: Outcome; twin: Outcome }[] = []
  for (let frame = 1; frame <= frames; frame++) {
    const held = twin.info.flatMap((page, p) => (page.flags !== 0 ? [p] : []))
    const requested = new Set(held.filter(() => random() < 0.45))
    // Now and then more requests than there are free pages.
    const grants = Math.floor(random() * (random() < 0.15 ? pages * 1.5 : pages / 4))
    const options = { hasPrevFrame: frame > 1, lruAllocation }
    const threads = Array.from({ length: pages }, (_, i) => i)
    // The threads of the keep rule in another order: its own draws, the frames' stay the same.
    if (shuffled) threads.sort(() => order() - 0.5)
    outcomes.push({
      gpu: gpu.frame(frame, requested, grants, { ...options, threads }),
      twin: twin.frame(frame, requested, grants, options),
    })
  }
  return outcomes
}
