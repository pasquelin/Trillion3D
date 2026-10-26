import { WPO_ROW_ALWAYS, WPO_ROW_VELOCITY } from '../../../visibility/types.ts'
import type { SurfaceRow } from '../surfaceRow.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import {
  offsetSwitchesOf,
  type ShadowCacheInvalidation,
} from '../../../../../sdk-core/src/world/object/offsetSwitches.ts'

/**
 * WHAT A ROW'S OBJECT SAYS OF THE OFFSET ITS SURFACE MOVES ITS VERTICES BY, as the row writer reads it
 * (`writeOffsetWords`): the switches of the object — whether it evaluates the offset, whether the
 * offset is a motion for the temporal pass, the distance past which it stops (`Object3D.evaluateWorldPositionOffset`,
 * `worldPositionOffsetWritesVelocity`, `worldPositionOffsetDisableDistance`) —, the centre of its
 * bounds in its primitive's space, which the distance is measured to, and the most the offset of its
 * surfaces may move a vertex, the greatest of them all (`maxWorldPositionOffset`). Written by
 * `frame/render/offsetReach.ts` for each root that wears an offset; a row of a root it names
 * nothing for takes the defaults of the switches.
 */
export interface RootOffsetRow {
  evaluate: boolean
  velocity: boolean
  /** In metres, 0 for never. */
  disable: number
  centre: readonly [number, number, number]
  /** In metres, 0 for no limit. */
  most: number
  /** Whether one of the root's surfaces wears an offset the session holds, and whether one of them
   *  always evaluates it (`alwaysEvaluateWorldPositionOffset`). */
  worn: boolean
  always: boolean
  /** How the object keeps its shadows (`Object3D.shadowCacheInvalidation`). */
  cache: ShadowCacheInvalidation
  /** Whether the object is a first-person one: its pages carry `PageInfo.firstPerson`
   *  (`PLACEMENT_FIRST_PERSON`); unset, it is not. */
  firstPerson?: boolean
  /** Whether the object is held out of the image's alpha (`Object3D.holdout`): its rows carry
   *  `FLAG_HOLDOUT` (`PLACEMENT_HOLDOUT`); unset, it is not. */
  holdout?: boolean
}

/** The switches' defaults: evaluated, a motion, never stopped by the distance. */
const DEFAULT_OFFSET_ROW: RootOffsetRow = {
  evaluate: true,
  velocity: true,
  disable: 0,
  centre: [0, 0, 0],
  most: 0,
  worn: false,
  always: false,
  cache: 'auto',
}

const NO_NODE = {}

/** The switches of an object, the defaults for none. */
export const switchesOfObject = (node: Object3D | undefined) => offsetSwitchesOf(node ?? NO_NODE)

/** The row of an object: `node`'s switches (the defaults for none; `s` when the caller has read them), the centre of its bounds and what
 *  its surfaces ask (`facts`: the greatest offset, whether one always evaluates; none, it wears none). */
export function objectOffsetRow(
  node: Object3D | undefined,
  centre: readonly [number, number, number],
  facts?: { most: number; always: boolean },
  s: ReturnType<typeof switchesOfObject> = switchesOfObject(node),
): RootOffsetRow {
  return {
    evaluate: s.evaluate,
    velocity: s.writesVelocity,
    disable: s.disableDistance,
    centre,
    most: facts?.most ?? 0,
    worn: !!facts,
    always: facts?.always === true,
    cache: s.shadowCache,
    ...(s.firstPerson ? { firstPerson: true } : {}),
    ...(s.holdout ? { holdout: true } : {}),
  }
}

/** Where a record keeps the offset words: the first word of each (`PageInfo`'s and a blend item's
 *  layouts both name them so). */
export interface OffsetWordsAt {
  readonly wpo: number
  readonly wpoDisableSq: number
  readonly wpoCentre: number
  readonly wpoMost: number
}

/** Writes the offset words of the record at `base` (`PageInfo.wpo`, `wpoDisableSq`, `wpoCentre`,
 *  `wpoMost`, at `at`): the bits of the surface's own (`SurfaceRow.wpo`) with the object's, zero for
 *  a surface that moves no vertex or an object that does not evaluate it (unless the surface always
 *  does). */
export function writeOffsetWords(
  ints: Uint32Array,
  floats: Float32Array,
  at: OffsetWordsAt,
  base: number,
  surface: SurfaceRow,
  object: RootOffsetRow = DEFAULT_OFFSET_ROW,
) {
  const moves = surface.wpo !== 0 && (object.evaluate || (surface.wpo & WPO_ROW_ALWAYS) !== 0)
  ints[base + at.wpo] = moves ? surface.wpo | (object.velocity ? WPO_ROW_VELOCITY : 0) : 0
  floats[base + at.wpoDisableSq] = moves ? object.disable * object.disable : 0
  for (let a = 0; a < 3; a++) floats[base + at.wpoCentre + a] = moves ? object.centre[a]! : 0
  floats[base + at.wpoMost] = moves ? Math.max(object.most, surface.wpoMost) : 0
}
