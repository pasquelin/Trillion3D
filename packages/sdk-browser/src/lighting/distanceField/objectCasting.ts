import { SHADOWLESS_ROOT, WORLD_SPACE_ROOT } from '../../visibility/shader/castingMark.ts'
import { OBJECT_FLAGS } from './layout.ts'

/**
 * How a root casts, as an object's flags: it casts a shadow unless its mark says it casts none. An
 * object that stands for a first-person one (`WORLD_SPACE_ROOT`) casts into the first-person clipmaps
 * alone, not the sun's cascade of the distance fields. Every placement is made of clusters
 * (`OBJECT_FLAGS.virtualized`), which a sun's shadow maps draw at any distance: the cascade leaves
 * them out unless the cascade lists the cluster meshes (`dfshCasts`). A parked root is out of the scene and casts none; a hidden one still casts.
 */
const castingFlags = (parked: boolean, mark: number) =>
  parked || mark & (SHADOWLESS_ROOT | WORLD_SPACE_ROOT) ? 0 : OBJECT_FLAGS.castShadow

export const flagsOf = (visible: boolean, parked: boolean, moving: boolean, mark: number) =>
  (moving ? OBJECT_FLAGS.oftenMoving : 0) |
  OBJECT_FLAGS.virtualized |
  (visible ? OBJECT_FLAGS.visible : 0) |
  castingFlags(parked, mark)
