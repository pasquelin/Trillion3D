import {
  FAR_SHADOW_ROOT,
  farTestedOf,
  SHADOWLESS_ROOT,
  WORLD_SPACE_ROOT,
} from '../../visibility/shader/castingMark.ts'
import { OBJECT_FLAGS } from './layout.ts'

/**
 * How a root casts, as an object's flags: it casts a shadow unless its mark says it casts none; a
 * sun's far-shadow test reaches it on its own account (`farTested`) or, if the view says it reaches
 * every mesh, whenever the mark does not say it never does (`farTestable`) — both by the one rule
 * of the test (`farTestedOf`, which the shadow raster's rows are built from too); it casts far
 * shadows if the mark says so (`castFarShadow`), which the shadow maps then draw at any distance.
 * `mark` holds `MARK_BITS.worldRoot` for a placement of the world DAG. An object that stands for a
 * first-person one (`WORLD_SPACE_ROOT`) casts into the first-person clipmaps alone, not the cascade.
 */
const castingFlags = (mark: number) =>
  (mark & (SHADOWLESS_ROOT | WORLD_SPACE_ROOT) ? 0 : OBJECT_FLAGS.castShadow) |
  (farTestedOf(mark, true) ? OBJECT_FLAGS.farTestable : 0) |
  (farTestedOf(mark, false) ? OBJECT_FLAGS.farTested : 0) |
  (mark & FAR_SHADOW_ROOT ? OBJECT_FLAGS.castsFar : 0)

/** Whether a sun's distance-field cascade shadows an object of mark `mark` whatever the view says: it
 *  casts, the far-shadow test reaches it and it does not cast far shadows. */
export const farShadowed = (mark: number) => {
  const flags = castingFlags(mark)
  return +(
    (flags & (OBJECT_FLAGS.castShadow | OBJECT_FLAGS.farTested | OBJECT_FLAGS.castsFar)) ===
    (OBJECT_FLAGS.castShadow | OBJECT_FLAGS.farTested)
  )
}

export const flagsOf = (visible: boolean, moving: boolean, mark: number) =>
  (moving ? OBJECT_FLAGS.oftenMoving : 0) |
  OBJECT_FLAGS.virtualized |
  (visible ? OBJECT_FLAGS.visible : 0) |
  castingFlags(mark)
