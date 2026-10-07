import { rasterDepth, type VisPage } from '../visibility/buffer.ts'
import { buildHizPyramid } from './depth.ts'
import { createEngineCamera, holdCameraWorld, type EngineCamera } from '../camera/world.ts'
import { countUnoccluded, filterUnoccluded } from './unoccluded.ts'
import { createHizCounts, resetHizCounts, type HizCounts } from './counts.ts'
import { splitOccludersInto } from './split.ts'
import { keepStaleRegions } from './staleRegions.ts'
import { copyRanks, depthOf, listsOf, unoccludedOf } from './cutLists.ts'
import type { CutLists } from './cutLists.ts'
import type { HizPage, HizPyramid } from './types.ts'
import { DEFAULT_PIXEL_RATIO } from '../engine/common.ts'
import type { PageLocations } from '../page/selection/placements.ts'

export type TemporalHizState = {
  pyramid?: HizPyramid
  /** Pass-1 pyramid, distinct from the history's: both live in the same frame, each keeps its
   *  buffer from one frame to the next. */
  passPyramid?: HizPyramid
  camera?: EngineCamera
  viewport?: [number, number]
  /** World boxes moved roots covered and cover since the pyramid was built (`staleRegions.ts`). */
  stale?: HizPage[]
  /** The lists the cut writes and returns, held from one image to the next (`./cutLists.ts`). */
  lists?: CutLists
  /** The depth the three rasters of the cut write, held like the lists (`./cutLists.ts`). */
  depth?: Float32Array
}

/** Same tolerance, same walk, without allocating: `Array.prototype.every` asked for a closure
 *  per compared matrix, twice per call and every frame. */
function presqueEgaux(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= 1e-7)) return false
  return true
}

/** Reuse depth only for an identical view. Any camera movement, cut or projection change starts a new history. */
export function sameHizView(previous: EngineCamera | undefined, current: EngineCamera) {
  if (!previous) return false
  // `previous` is the camera `holdCameraWorld` holds: the same sixteen view and projection
  // numbers the frame entry copied, with nothing to walk up or invert again.
  return (
    presqueEgaux(previous.view, current.view) &&
    presqueEgaux(previous.projection, current.projection)
  )
}

/** Holds the frame that was just rasterised: the camera is copied into the one history already
 *  holds, never cloned, the pyramid rewritten in its own buffer and the viewport in place.
 *  Same pose, same pyramid, no allocation. */
function retiens(
  history: TemporalHizState,
  cam: EngineCamera,
  viewport: [number, number],
  depth: Float32Array,
) {
  history.pyramid = buildHizPyramid(depth, viewport[0], viewport[1], history.pyramid)
  if (history.stale) history.stale.length = 0
  history.camera = holdCameraWorld(history.camera ?? createEngineCamera(), cam)
  if (!history.viewport) history.viewport = [viewport[0], viewport[1]]
  else {
    history.viewport[0] = viewport[0]
    history.viewport[1] = viewport[1]
  }
}

/** What the history holds still describes this image: a pyramid, the camera it was built from, and
 *  the viewport it was built for. Only then does the cut walk it instead of the depth order. */
function holdsThisView(history: TemporalHizState, cam: EngineCamera, viewport: [number, number]) {
  return !!(
    history.pyramid &&
    history.camera &&
    sameHizView(history.camera, cam) &&
    history.viewport?.[0] === viewport[0] &&
    history.viewport?.[1] === viewport[1]
  )
}

/** The nearest half as this image's occluders, the rest behind it: what the cut falls back on when
 *  the history holds nothing, or when a page it kept leaves one half empty. */
function splitByDepth<T extends HizPage & VisPage>(
  selected: T[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  lists: CutLists<T>,
) {
  const { occluders, rest, occludersPacked, restPacked } = lists
  splitOccludersInto(
    selected,
    locations,
    cam,
    viewport,
    occluders,
    rest,
    occludersPacked,
    restPacked,
  )
}

/** An image with no half to cull: the whole cut drawn, and the history's pyramid rebuilt from it —
 *  what the next image will test against. `occluders` is what the caller had cut out, empty when it
 *  had none, and the ranks land in the list the history was just given (`listsOf`). */
function noCull<T extends HizPage & VisPage>(
  selected: T[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio: number,
  history: TemporalHizState,
  counts: HizCounts,
  occluders: T[],
) {
  retiens(
    history,
    cam,
    viewport,
    rasterDepth(selected, locations, cam, viewport, pixelRatio, depthOf(history, viewport)),
  )
  return {
    shown: selected,
    shownPacked: copyRanks(history.lists!.shownPacked, locations.packed),
    hizRejected: 0,
    occluders,
    history,
    counts,
  }
}

/** The cut the image draws: the occluders of the first pass, then the pages the pyramid they
 *  rasterise does not occlude. What is drawn becomes the pyramid the next image tests against. */
function drawnCut<T extends HizPage & VisPage>(
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio: number,
  history: TemporalHizState,
  counts: HizCounts,
  lists: CutLists<T>,
) {
  const { occluders, occludersPacked, rest, restPacked, kept, keptIndices, shown, shownPacked } =
    lists
  history.passPyramid = buildHizPyramid(
    rasterDepth(
      occluders,
      lists.occludersAt,
      cam,
      viewport,
      pixelRatio,
      depthOf(history, viewport),
    ),
    viewport[0],
    viewport[1],
    history.passPyramid,
  )
  const disoccluded = countUnoccluded(
    rest,
    lists.restAt,
    history.passPyramid,
    cam,
    viewport,
    counts,
    keptIndices,
    0,
    kept,
  )
  shown.length = 0
  shownPacked.length = 0
  for (let i = 0; i < occluders.length; i++) {
    shown.push(occluders[i])
    shownPacked.push(occludersPacked[i])
  }
  for (let i = 0; i < keptIndices.length; i++) {
    shown.push(disoccluded[i])
    shownPacked.push(restPacked[keptIndices[i]])
  }
  // The pass-1 pyramid above already copied its depth, so this raster writes the same buffer again.
  retiens(
    history,
    cam,
    viewport,
    rasterDepth(shown, lists.shownAt, cam, viewport, pixelRatio, depthOf(history, viewport)),
  )
  return {
    shown,
    shownPacked,
    hizRejected: rest.length - disoccluded.length,
    occluders,
    history,
    counts,
  }
}

/**
 * Apply Temporal Hi-Z occlusion culling using previous frame's depth pyramid reprojection.
 * Candidate pages are tested against the previous frame's Hi-Z pyramid.
 * Previously visible pages form Pass 1 occluders; current frame pyramid is built, then occluded
 * or newly disoccluded pages are tested in Pass 2. The depth raster widens line pages at
 * `pixelRatio` image pixels per CSS pixel, as the image does.
 */
export function applyTemporalHiz<T extends HizPage & VisPage>(
  selected: T[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  history: TemporalHizState = {},
  counts: HizCounts = createHizCounts(),
  pixelRatio = DEFAULT_PIXEL_RATIO,
): {
  shown: T[]
  /** The packed rank of each shown page, rank by rank (#1235). */
  shownPacked: number[]
  hizRejected: number
  occluders: T[]
  history: TemporalHizState
  counts: HizCounts
} {
  const lists = listsOf<T>(history, locations),
    { occluders, rest, occludersPacked, restPacked, kept, keptIndices } = lists,
    all = locations.packed
  resetHizCounts(counts)
  occluders.length = rest.length = occludersPacked.length = restPacked.length = 0
  if (selected.length < 2)
    return noCull(selected, locations, cam, viewport, pixelRatio, history, counts, selected)
  if (holdsThisView(history, cam, viewport)) {
    const prevCam = history.camera!
    filterUnoccluded(selected, locations, history.pyramid!, prevCam, viewport, keptIndices, 0, kept)
    // Membership is by rank in the cut, one instance each: a record may serve several placements.
    const unoccluded = unoccludedOf(lists, selected.length)
    for (let i = 0; i < keptIndices.length; i++) unoccluded[keptIndices[i]] = 1
    if (history.stale?.length)
      keepStaleRegions(selected, locations, history.stale, prevCam, viewport, unoccluded)
    for (let i = 0; i < selected.length; i++)
      if (unoccluded[i]) {
        occluders.push(selected[i])
        occludersPacked.push(all[i])
      } else {
        rest.push(selected[i])
        restPacked.push(all[i])
      }
  }
  if (!occluders.length || !rest.length) splitByDepth(selected, locations, cam, viewport, lists)
  if (!occluders.length || !rest.length)
    return noCull(selected, locations, cam, viewport, pixelRatio, history, counts, occluders)
  return drawnCut(cam, viewport, pixelRatio, history, counts, lists)
}
