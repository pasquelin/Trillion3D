import {
  offsetSwitchesOf,
  type ShadowCacheInvalidation,
} from '../../../../sdk-core/src/world/object/offsetSwitches.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/** What a saved node says of its world position offset (`Object3D.evaluateWorldPositionOffset` and
 *  the switches beside it): only a switch that is not at its default is written. */
export interface SavedOffsets {
  /** Whether its surfaces' offsets are not evaluated; absent, they are. */
  evaluateWorldPositionOffset?: false
  /** The distance in metres past which its offset stops; absent, never. */
  worldPositionOffsetDisableDistance?: number
  /** Whether its offset is not a motion for the temporal antialiasing; absent, it is. */
  worldPositionOffsetWritesVelocity?: false
  /** How its shadows are kept while its offset moves it; absent, `auto`. */
  shadowCacheInvalidation?: Exclude<ShadowCacheInvalidation, 'auto'>
  /** An object drawn as a first-person one (`Object3D.firstPerson`); absent, it is not. */
  firstPerson?: true
  /** An object that stands for a first-person one in the world
   *  (`Object3D.firstPersonWorldSpaceRepresentation`); absent, it is not. */
  firstPersonWorldSpaceRepresentation?: true
  /** An object that casts its shadow while hidden (`Object3D.castHiddenShadow`); absent, it does not. */
  castHiddenShadow?: true
  /** An object held out of the image's alpha (`Object3D.holdout`); absent, it is not. */
  holdout?: true
}

/** The switches of `o` that are not at their defaults. */
export function savedOffsets(o: Object3D): SavedOffsets {
  const s = offsetSwitchesOf(o)
  return {
    ...(s.evaluate ? {} : { evaluateWorldPositionOffset: false as const }),
    ...(s.disableDistance === 0 ? {} : { worldPositionOffsetDisableDistance: s.disableDistance }),
    ...(s.writesVelocity ? {} : { worldPositionOffsetWritesVelocity: false as const }),
    ...(s.shadowCache === 'auto' ? {} : { shadowCacheInvalidation: s.shadowCache }),
    ...(s.firstPerson ? { firstPerson: true as const } : {}),
    ...(s.worldSpaceRepresentation ? { firstPersonWorldSpaceRepresentation: true as const } : {}),
    ...(s.castHiddenShadow ? { castHiddenShadow: true as const } : {}),
    ...(s.holdout ? { holdout: true as const } : {}),
  }
}

/** Gives `o` the switches `saved` holds, the defaults where it holds none. */
export function wearOffsets(o: Object3D, saved: SavedOffsets) {
  o.evaluateWorldPositionOffset = saved.evaluateWorldPositionOffset ?? true
  o.worldPositionOffsetDisableDistance = saved.worldPositionOffsetDisableDistance ?? 0
  o.worldPositionOffsetWritesVelocity = saved.worldPositionOffsetWritesVelocity ?? true
  o.shadowCacheInvalidation = saved.shadowCacheInvalidation ?? 'auto'
  // The one turned off first: a first-person switch turned on is refused while its other is on.
  o.firstPerson = false
  o.firstPersonWorldSpaceRepresentation = false
  o.firstPerson = saved.firstPerson ?? false
  o.firstPersonWorldSpaceRepresentation = saved.firstPersonWorldSpaceRepresentation ?? false
  o.castHiddenShadow = saved.castHiddenShadow ?? false
  o.holdout = saved.holdout ?? false
}
