import {
  NO_DISTANCE_FIELD_ROOT,
  SHADOWLESS_ROOT,
  WORLD_SPACE_ROOT,
} from '../../visibility/shader/castingMark.ts'
import { OBJECT_FLAGS } from './layout.ts'

/**
 * How a root casts, as an object's flags: it casts a shadow unless its mark says it casts none. An
 * object that stands for a first-person one (`WORLD_SPACE_ROOT`) casts into the first-person clipmaps
 * alone, not the suns' distance-field lists of the cards (`dfshCasts`). A root that leaves their scene
 * (`NO_DISTANCE_FIELD_ROOT`) casts none. A parked root is out of the scene and casts none; a hidden one still
 * casts.
 */
const castingFlags = (parked: boolean, mark: number) =>
  parked || mark & (SHADOWLESS_ROOT | WORLD_SPACE_ROOT | NO_DISTANCE_FIELD_ROOT)
    ? 0
    : OBJECT_FLAGS.castShadow

export const flagsOf = (visible: boolean, parked: boolean, moving: boolean, mark: number) =>
  (moving ? OBJECT_FLAGS.oftenMoving : 0) |
  (visible ? OBJECT_FLAGS.visible : 0) |
  castingFlags(parked, mark)
