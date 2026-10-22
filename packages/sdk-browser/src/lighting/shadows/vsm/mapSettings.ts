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
import type { VsmLightCache } from './cacheManager.ts'

/** The settings a setup reads when its host gives none: every default. */
export const VSM_DEFAULT_SHADOWS: ShadowValues = Object.freeze(resolveSettings(SHADOW_RULES, {}))

/** What the maps' setup reads of a frame: the view's shadow settings and the scene frame number
 *  the lights' mobility counts in (`vsmLightMobility`); absent, the cache's own frame. */
export interface VsmMapSettings {
  readonly shadows: ShadowValues
  readonly frame?: number
}

/** The settings of a setup whose host gives none. */
export const VSM_DEFAULT_MAPS: VsmMapSettings = { shadows: VSM_DEFAULT_SHADOWS }

/** The clipmap levels a sun's shadows take at most — from the first level to the last, the last
 *  never below the first; an orthographic view may start coarser. */
export const vsmSunLevels = ({ shadowClipmapFirstLevel, shadowClipmapLastLevel }: ShadowValues) =>
  Math.max(shadowClipmapFirstLevel, shadowClipmapLastLevel) - shadowClipmapFirstLevel + 1

/**
 * The resolution bias of a light at mobility `factor`, from 0 (it has not moved lately) to 1 (it
 * moves): `still` at 0, at 1 `moving` when that is the coarser, else `still` — a light that moves
 * never takes a finer bias than it rests at.
 */
export const vsmMovingBias = (still: number, moving: number, factor: number) =>
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

/** The scene frame each light's entry last moved at (`vsmLightMobility`). */
const movedAt = new WeakMap<VsmLightCache, number>()

/**
 * The mobility factor of a light, from 0 to 1, at scene frame `frame`: 1 the frame it was made or
 * `moved` — its direction, its position, its shape changed —, then falling to 0 over the next
 * `activeFrames` frames in equal steps (`shadowLightActiveFrameCount`), and 0 from there until it
 * moves again. Every light of the scene can move: none is fixed in place.
 */
export function vsmLightMobility(
  entry: VsmLightCache,
  moved: boolean,
  frame: number,
  activeFrames: number,
) {
  if (moved || !movedAt.has(entry)) movedAt.set(entry, frame)
  const elapsed = Math.max(0, frame - movedAt.get(entry)!)
  return elapsed < activeFrames ? 1 - elapsed / activeFrames : 0
}

/** A clipmap's level range and coarse-page marking, from the settings. */
export interface VsmClipmapConfig {
  firstLevel: number
  lastLevel: number
  /** The levels whose coarse pages are marked, `coarseFrom` -1 for none. */
  coarseFrom: number
  coarseTo: number
  /** Whether the coarse pages keep their dynamic layer cached (`VSM_MAP_COARSE_KEEPS_DYNAMIC`). */
  keepsDynamic: boolean
}

/** The config of the clipmap being set up, rewritten by each `vsmClipmapConfig`. */
const config: VsmClipmapConfig = {
  ...{ firstLevel: 0, lastLevel: 0, coarseFrom: -1, coarseTo: -1, keepsDynamic: false },
}

/** The clipmap config `shadows` ask, the one object rewritten: no coarse level when the marking is
 *  off (mode 0), the coarse pages keeping their dynamic layer in mode 2. */
export function vsmClipmapConfig(shadows: ShadowValues) {
  const marks = shadows.shadowMarkCoarsePagesDirectional
  config.firstLevel = shadows.shadowClipmapFirstLevel
  config.lastLevel = shadows.shadowClipmapLastLevel
  config.coarseFrom = marks === 0 ? -1 : shadows.shadowClipmapFirstCoarseLevel
  config.coarseTo = marks === 0 ? -1 : shadows.shadowClipmapLastCoarseLevel
  config.keepsDynamic = marks === 2
  return config
}
