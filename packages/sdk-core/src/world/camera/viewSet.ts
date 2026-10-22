import type { Object3D } from '../object/object3d.ts'
import { NO_CLIP_PLANE, type ClipPlaneValues } from '../../contracts/viewOptions.ts'

/**
 * WHAT A CAMERA'S VIEW CARRIES BESIDE ITS EYE, as the engine reads it (`Camera._viewSet`): the clip
 * plane and the two lists of objects (`../../contracts/viewOptions.ts` says what each means).
 * Replaced whole at every write, never changed in place, so its identity is its revision: a view
 * whose set is the one it was drawn with has drawn the same filter and plane.
 */
export interface ViewSet {
  /** The plane, `[nx, ny, nz, w]`; all zero for none. */
  readonly clipPlane: ClipPlaneValues
  /** Whether the view is drawn with the temporal jitter: false for a view that has a clip plane,
   *  whose cut would move with it; set with the plane, where the set is made. */
  readonly jitters: boolean
  /** The objects the view does not draw. */
  readonly hidden: readonly Object3D[]
  /** The only objects the view draws; `null` for every object. */
  readonly showOnly: readonly Object3D[] | null
}

/** The set of a camera that clips and filters nothing, shared by every one that has none. */
export const NO_VIEW_SET: ViewSet = Object.freeze({
  clipPlane: NO_CLIP_PLANE,
  jitters: true,
  hidden: Object.freeze([]) as readonly Object3D[],
  showOnly: null,
})
