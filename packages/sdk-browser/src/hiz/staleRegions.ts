import { HIZ_BOUNDS_VALUES } from './corners.ts'
import { IDENTITY_LOCATIONS, boundsFor, projectBoxesFlat } from './projection.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { HizPage } from './types.ts'
import type { TemporalHizState } from './temporal.ts'
import type { PageLocations } from '../page/selection/placements.ts'

/**
 * THE REGIONS OF THE TEMPORAL PYRAMID A MOVE STALED. A moved root leaves the history's
 * depth wrong where it stood and where it stands now, and right everywhere else: the view is the
 * same (`sameHizView`) and nothing else moved. So the pyramid is kept, and the world boxes the root
 * covered and covers are listed with it; the next image takes every page whose screen rectangle
 * meets one of them as a first-pass occluder, as a pyramid cleared there would. The history only
 * splits the cut: what the image drops is tested against this image's own occluders, so no
 * choice made here can drop a visible page. A box with a number that is not finite stales it all.
 */
export function staleTemporalBox(
  history: TemporalHizState,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  if (!history.pyramid) return
  const box = [min[0], min[1], min[2], max[0], max[1], max[2]]
  if (!box.every(Number.isFinite)) {
    history.pyramid = history.camera = undefined
    return
  }
  ;(history.stale ??= []).push({ min: box.slice(0, 3), max: box.slice(3) })
}

let staleBounds = new Float64Array(HIZ_BOUNDS_VALUES)

/** Marks in `kept`, by rank in `pages`, every page (located by `locations`) whose rectangle meets
 *  a staled region, seen from `cam`: by rank, since one record may stand for several placements. */
export function keepStaleRegions<T extends HizPage>(
  pages: readonly T[],
  locations: PageLocations,
  stale: readonly HizPage[],
  cam: EngineCamera,
  viewport: [number, number],
  kept: Uint8Array,
) {
  const need = stale.length * HIZ_BOUNDS_VALUES
  if (staleBounds.length < need) staleBounds = new Float64Array(need)
  projectBoxesFlat(stale, IDENTITY_LOCATIONS, stale.length, cam, viewport, staleBounds)
  const bounds = boundsFor(pages.length)
  projectBoxesFlat(pages, locations, pages.length, cam, viewport, bounds)
  for (let i = 0; i < pages.length; i++) {
    const at = i * HIZ_BOUNDS_VALUES
    for (let s = 0; s < need; s += HIZ_BOUNDS_VALUES)
      if (
        staleBounds[s + 5] !== 0 ||
        (bounds[at] <= staleBounds[s + 2] &&
          bounds[at + 2] >= staleBounds[s] &&
          bounds[at + 1] <= staleBounds[s + 3] &&
          bounds[at + 3] >= staleBounds[s + 1])
      ) {
        kept[i] = 1
        break
      }
  }
}
