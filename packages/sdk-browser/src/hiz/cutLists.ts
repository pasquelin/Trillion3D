// The lists a temporal Hi-Z cut writes and returns, held on the history of the view that wrote
// them (packages/sdk-browser/src/webgpu/pages/state/view.ts:35, `VIEW_RUN_KEYS`): the pyramid of
// that history already survives from one image to the next, the lists that fill it did not, and at
// eighty thousand pages they cost more than the test they serve. Never at module level — two views
// run their own cut on their own history — and a caller that keeps what it is handed must copy it
// first, which is what the engine's only production caller does
// (packages/sdk-browser/src/webgpu/pages/render/cpu.ts:76-84).
import type { HizPage } from './types.ts'
import type { PageLocations, Placements } from '../page/selection/placements.ts'

/** A placed list whose three fields are rewritten each image: the same object every image, its
 *  `packed` the buffer the cut itself fills. `PageLocations` alone is read-only. */
type MutableLocations = { roots: Placements; packed: ArrayLike<number>; rootOfPacked: Int32Array }

/** What one cut writes, image after image. `keptIndices` is filled by both passes in turn: the
 *  history reads it into `unoccluded` before the pass-1 pyramid asks for it again, so the ranks of
 *  the kept pages and the pages kept of the occluded half never sit in the same list. */
export type CutLists<T = HizPage> = {
  /** The pages the history kept as this image's occluders, and the ones it did not. */
  occluders: T[]
  rest: T[]
  /** The pages the pass-1 pyramid did not occlude: the disoccluded half of the shown cut. */
  kept: T[]
  /** The shown cut: the occluders, then the pages the pass-1 pyramid kept. */
  shown: T[]
  /** The packed rank of each page of the three lists above, rank by rank. */
  occludersPacked: number[]
  restPacked: number[]
  shownPacked: number[]
  /** Rank in the tested list of every page its pyramid kept. */
  keptIndices: number[]
  /** One byte per page of the cut, set for the pages the history kept and cleared for the rest. */
  unoccluded: Uint8Array
  /** Each list placed by the roots of the image, which name its packed ranks. */
  occludersAt: MutableLocations
  restAt: MutableLocations
  shownAt: MutableLocations
}

/** The lists a history has none of yet: empty, and each placed view on the packed buffer it will
 *  always describe. */
function newCutLists<T>(): CutLists<T> {
  const lists: CutLists<T> = {
    occluders: [],
    rest: [],
    kept: [],
    shown: [],
    occludersPacked: [],
    restPacked: [],
    shownPacked: [],
    keptIndices: [],
    unoccluded: new Uint8Array(0),
    occludersAt: { roots: [], packed: [], rootOfPacked: new Int32Array(0) },
    restAt: { roots: [], packed: [], rootOfPacked: new Int32Array(0) },
    shownAt: { roots: [], packed: [], rootOfPacked: new Int32Array(0) },
  }
  lists.occludersAt.packed = lists.occludersPacked
  lists.restAt.packed = lists.restPacked
  lists.shownAt.packed = lists.shownPacked
  return lists
}

/** Points a placed view at the roots of this image; its packed buffer it already carries. */
function placeAt(at: MutableLocations, locations: PageLocations) {
  at.roots = locations.roots
  at.rootOfPacked = locations.rootOfPacked
}

/** The lists of a history, made once and placed on this image's roots: at the page type of the cut
 *  that asks for them. The state carries the base page type, and a list holds exactly the records
 *  that cut was handed. */
export function listsOf<T>(history: { lists?: CutLists }, locations: PageLocations): CutLists<T> {
  const lists = (history.lists ??= newCutLists()) as CutLists<T>
  placeAt(lists.occludersAt, locations)
  placeAt(lists.restAt, locations)
  placeAt(lists.shownAt, locations)
  return lists
}

/** The depth the cut rasters into, wide enough for this image: one array for the three passes,
 *  widened when the viewport grew, never narrowed. Reusing it is safe because `hizBuildFlat` copies
 *  the depth into each pyramid's own buffer (`sdk-core/src/hiz/pyramidFlat.ts:107`) — the history's
 *  and the first pass's are two pyramids of their own and never alias. */
export function depthOf(history: { depth?: Float32Array }, viewport: [number, number]) {
  const pixels = viewport[0] * viewport[1]
  if (!history.depth || history.depth.length < pixels) history.depth = new Float32Array(pixels)
  return history.depth
}

/** One cleared byte per page of the cut, wide enough to carry them: widened when the cut grew,
 *  never narrowed, never reallocated for a cut that did not. */
export function unoccludedOf<T>(lists: CutLists<T>, count: number) {
  if (lists.unoccluded.length < count) lists.unoccluded = new Uint8Array(count)
  else lists.unoccluded.fill(0, 0, count)
  return lists.unoccluded
}

/** `source`'s ranks copied into `target`, rank by rank: what `Array.from` gave the cut, without the
 *  array it made every image. */
export function copyRanks(target: number[], source: ArrayLike<number>) {
  for (let i = 0; i < source.length; i++) target[i] = source[i]
  target.length = source.length
  return target
}
