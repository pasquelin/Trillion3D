/**
 * THE SHADOW MAPS' SETTINGS AS THE MAPS' SETUP READS THEM (`clipmap.ts`, `localLight.ts`): the
 * view's settings of `shadowMapOptions.ts` resolved once a frame, the scene frame they are read at,
 * and the three rules the setup applies to them — the clipmap's level count, the resolution bias
 * of a light that moved lately, and the frames a light counts as moving.
 */
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  SHADOW_RULES,
  type ShadowValues,
} from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { adoptEntries } from '../../../gpu/core/adoptEntries.ts'
import { noDofBias, type VsmDofBias } from './dofBias.ts'

/** The settings a setup reads when its host gives none: every default. */
export const VSM_DEFAULT_SHADOWS: ShadowValues = Object.freeze(resolveSettings(SHADOW_RULES, {}))

/** What the maps' setup reads of a frame: the view's shadow settings and the scene frame number
 *  the lights' mobility counts in (`vsmLightMobility`) and the distant lights' schedule turns on
 *  (`scheduleDistantUpdates`). */
export interface VsmMapSettings {
  readonly shadows: ShadowValues
  readonly frame: number
  /** The depth of field's bias on the maps' resolution, rewritten each frame (`frame/vsmDof.ts`). */
  readonly dof: VsmDofBias
  /** Whether the suns take a first-person clipmap this frame: `shadowFirstPersonClipmap` on and the
   *  scene holding an object that stands for a first-person one; rewritten each frame
   *  (`frame/vsmFarShadow.ts`). Absent, no. */
  readonly firstPerson?: { active: boolean }
}

/** The settings of a setup whose host gives none. */
export const VSM_DEFAULT_MAPS: VsmMapSettings = {
  shadows: VSM_DEFAULT_SHADOWS,
  frame: 0,
  dof: noDofBias(),
}

/** The clipmap levels a sun's shadows take at most — from the first level to the last, the last
 *  never below the first; an orthographic view may start coarser. */
export const vsmSunLevels = ({ shadowClipmapFirstLevel, shadowClipmapLastLevel }: ShadowValues) =>
  Math.max(shadowClipmapFirstLevel, shadowClipmapLastLevel) - shadowClipmapFirstLevel + 1

/**
 * The resolution bias of a light at mobility `factor`, from 0 (it has not moved lately) to 1 (it
 * moves): `still` at 0, at 1 `moving` when that is the coarser, else `still` — a light that moves
 * never takes a finer bias than it rests at.
 */
const vsmMovingBias = (still: number, moving: number, factor: number) =>
  still + factor * (Math.max(still, moving) - still)

/** A sun's resolution bias at mobility `mobility` (`vsmLightMobility`): the settings' at rest and
 *  moving, the screen's term and the light's own added, never below 0 — a negative bias sharpens
 *  only until it has used up the screen term; below it a receiver would read a level too small to
 *  reach it. */
export function vsmSunBias(shadows: ShadowValues, mobility: number, screen: number, own: number) {
  const still = shadows.shadowResolutionLodBiasDirectional,
    moving = shadows.shadowResolutionLodBiasDirectionalMoving
  const bias = Math.fround(vsmMovingBias(still, moving, mobility) + screen)
  return Math.max(0, Math.fround(bias + own))
}

/** A local light's resolution bias at mobility `mobility`: the settings' at rest and moving, the
 *  light's own added. */
export function vsmLocalBias(shadows: ShadowValues, mobility: number, own: number) {
  const still = shadows.shadowResolutionLodBiasLocal,
    moving = shadows.shadowResolutionLodBiasLocalMoving
  return Math.fround(vsmMovingBias(still, moving, mobility) + own)
}

/** What a light's mobility keeps of it: the scene frame it last moved at and the pose it was last
 *  asked at (`vsmLightPose`). It moved at `frame` when `movedAt` is `frame`, whoever asks. */
export interface VsmLightMove {
  movedAt: number
  pose: number[]
}

/**
 * The record of the light `lightId` in `moves` (`VsmCacheManager.lightMoves`) once asked at the pose
 * `pose` — its direction or, for a local light, its position, rotation and shape — at scene frame
 * `frame`: `movedAt` is then `frame` when that pose differs from the one it was last asked at, or is
 * the first ask. The light's own move, as the reference marks a light whose transform was
 * updated active: not its cache entry's, so a view's zoom or a setting is no move, and a move while
 * the entry was dropped counts. Kept per light, a light that comes back into view keeps its factor.
 */
export function vsmLightPose(
  moves: Map<string, VsmLightMove>,
  lightId: string,
  pose: ArrayLike<number>,
  frame: number,
) {
  const move = moves.get(lightId)
  if (!move) {
    const first = { movedAt: frame, pose: Array.from(pose) }
    moves.set(lightId, first)
    return first
  }
  if (adoptEntries(move.pose, pose)) move.movedAt = frame
  return move
}

/**
 * The mobility factor of a light that moved at `move.movedAt`, from 0 to 1, at scene frame `frame`: 1
 * the frame it moved, then falling to 0 over the next `activeFrames` frames in equal steps
 * (`shadowLightActiveFrameCount`), and 0 from there until it moves again.
 */
export function vsmMobilityAt(move: VsmLightMove, frame: number, activeFrames: number) {
  const elapsed = Math.max(0, frame - move.movedAt)
  return elapsed < activeFrames ? 1 - elapsed / activeFrames : 0
}

/** The mobility factor of the light `lightId` asked at `pose` (`vsmLightPose`, `vsmMobilityAt`). Only a
 *  `movable` light asks it (`VsmLocalLightInput.movable`): a static or stationary one rests at the
 *  still bias from its first frame. */
export const vsmLightMobility = (
  moves: Map<string, VsmLightMove>,
  lightId: string,
  pose: ArrayLike<number>,
  frame: number,
  activeFrames: number,
) => vsmMobilityAt(vsmLightPose(moves, lightId, pose, frame), frame, activeFrames)

/** A clipmap's level range and coarse-page marking, from the settings. */
export interface VsmClipmapConfig {
  firstLevel: number
  lastLevel: number
  /** The levels whose coarse pages are marked, `coarseFrom` -1 for none. */
  coarseFrom: number
  coarseTo: number
  /** Whether the coarse pages keep their dynamic layer cached (`VSM_MAP_COARSE_KEEPS_DYNAMIC`). */
  keepsDynamic: boolean
  /** Whether a level leaves out the offsets of the objects that stop theirs short of it
   *  (`shadowClipmapWpoDisableDistance`), the levels it keeps them past the distance
   *  (`shadowClipmapWpoDisableDistanceLodBias`), and whether a shift of that distance's level redraws
   *  the level's pages (`shadowClipmapWpoDisableDistanceInvalidateOnScaleChange`). */
  wpoDisable: boolean
  wpoLodBias: number
  wpoInvalidatesOnScale: boolean
  /** Whether the clipmap keeps no page from one frame to the next: all its levels are drawn again
   *  each frame (`shadowForceInvalidateDirectional`; a first-person clipmap always). */
  forceInvalidate: boolean
  /** Whether the depth a level's moving casters are culled by ends at the level's own radius
   *  (`shadowClipmapCullDynamicTightly`); a clipmap that keeps no page also cuts its depth range
   *  there. */
  cullTightly: boolean
  /** What an orthographic view does to its clipmaps' first level: sizes it on its box
   *  (`shadowOrthoEstimateClipmapLevels`) and the levels it adds to that
   *  (`shadowOrthoClipmapLodBias`). Its origin is `viewOrigin.ts`'s. */
  orthoEstimateLevels: boolean
  orthoLodBias: number
  /** Whether the clipmap holds a prefiltered distant shadow (`shadowPrefilteredDistant`): the sun's
   *  regular clipmap alone, drawn uncached with its depth cut at each level's end
   *  (`forceInvalidate`, `cullTightly`), its levels' depth ranges the bands each draws into the
   *  filtered pages. */
  prefilteredDistant: boolean
  /** Whether the clipmap's pages are drawn for the receivers' cover alone
   *  (`shadowUseReceiverMaskDirectional`); the dynamic casters' depth range is cut only with it. */
  useCover: boolean
}

/** The config of the clipmap being set up, rewritten by each `vsmClipmapConfig`. */
const config: VsmClipmapConfig = {
  ...{ firstLevel: 0, lastLevel: 0, coarseFrom: -1, coarseTo: -1, keepsDynamic: false },
  ...{ wpoDisable: false, wpoLodBias: 0, wpoInvalidatesOnScale: false },
  ...{ forceInvalidate: false, cullTightly: true, useCover: true, prefilteredDistant: false },
  ...{ orthoEstimateLevels: true, orthoLodBias: 0 },
}

/** The config of a sun's first-person clipmap (`shadowFirstPersonClipmap`): the view's settings with its
 *  own level range, no coarse level and no page kept, and no prefiltered distant shadow; the one
 *  object rewritten, as `vsmClipmapConfig`'s. Its coarse pages' dynamic layer is kept as the view's
 *  setting has it, as for any clipmap. */
export function vsmFirstPersonClipmapConfig(shadows: ShadowValues) {
  viewClipmapConfig(shadows)
  config.firstLevel = shadows.shadowFirstPersonClipmapFirstLevel
  config.lastLevel = shadows.shadowFirstPersonClipmapLastLevel
  config.coarseFrom = -1
  config.coarseTo = -1
  config.forceInvalidate = true
  return config
}

/** The clipmap config `shadows` ask, the one object rewritten: no coarse level when the marking is
 *  off (mode 0), the coarse pages keeping their dynamic layer in mode 2. With the prefiltered distant
 *  shadow the sun's clipmap keeps no page and cuts the depth of its levels. */
export function vsmClipmapConfig(shadows: ShadowValues) {
  viewClipmapConfig(shadows)
  if (shadows.shadowPrefilteredDistant) {
    config.prefilteredDistant = true
    config.forceInvalidate = true
    config.cullTightly = true
  }
  return config
}

/** The config the view's settings give any clipmap of a sun, the one object rewritten. */
function viewClipmapConfig(shadows: ShadowValues) {
  const marks = shadows.shadowMarkCoarsePagesDirectional
  config.firstLevel = shadows.shadowClipmapFirstLevel
  config.lastLevel = shadows.shadowClipmapLastLevel
  config.coarseFrom = marks === 0 ? -1 : shadows.shadowClipmapFirstCoarseLevel
  config.coarseTo = marks === 0 ? -1 : shadows.shadowClipmapLastCoarseLevel
  config.keepsDynamic = marks === 2
  config.wpoDisable = shadows.shadowClipmapWpoDisableDistance
  config.wpoLodBias = shadows.shadowClipmapWpoDisableDistanceLodBias
  config.wpoInvalidatesOnScale = shadows.shadowClipmapWpoDisableDistanceInvalidateOnScaleChange
  // Classic cascades are drawn whole each image unless `shadowCsmCaching` keeps them (the pages a sliding cascade still covers are then reused).
  config.forceInvalidate =
    shadows.shadowForceInvalidateDirectional ||
    (!shadows.shadowVirtualEnable && !shadows.shadowCsmCaching)
  config.cullTightly = shadows.shadowClipmapCullDynamicTightly
  config.useCover = shadows.shadowUseReceiverMaskDirectional
  config.orthoEstimateLevels = shadows.shadowOrthoEstimateClipmapLevels
  config.orthoLodBias = shadows.shadowOrthoClipmapLodBias
  config.prefilteredDistant = false
}
