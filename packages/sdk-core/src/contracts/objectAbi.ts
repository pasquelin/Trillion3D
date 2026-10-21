/**
 * The job's per-object settings — whether an object streams on the main grid, whether a skinned
 * object is an instanced one playing a baked clip —, their field, flag, keys and defaults, printed
 * into the compiler's Rust like the rest of `compilerAbi.ts` (`objectOptions.ts` reads them).
 */
import type { HlodWireMatch } from './hlodAbi.ts'

/** The job field setting each object's settings (`resolveObjectSettings`): the settings of
 *  `OBJECT_SETTINGS` for every object of the scene, and under `OBJECT_SETTINGS_OBJECTS` the rules
 *  `{ match, …settings }` that set them for the objects a match names — as `meshBuild` names its
 *  objects. For each setting of an object, the first that names it wins: the first rule matching
 *  it, then the scene's setting, then its own node's glTF `extras` under the setting's name, then
 *  its default. The command line's `--object-settings=` flag holds it as JSON. A job leaving it out
 *  keeps its cache key. */
export const OBJECT_SETTINGS_FIELD = 'objectSettings'
/** The command line's flag setting each object's settings, its JSON after the `=`. */
export const OBJECT_SETTINGS_OPTION = '--object-settings='
/** The key of `objectSettings` holding its rules by object, in order. */
export const OBJECT_SETTINGS_OBJECTS = 'objects'
/** Whether an object streams on the partition's main grid — drawn while the view lies within the
 *  grid's loading range of its cell — (`true`, the reference's default for every object), or is
 *  loaded with the scene and always drawn (`false`). An animated object streams too, and no HLOD
 *  stands for it past its cell's range. */
export const SPATIALLY_LOADED_SETTING = 'spatiallyLoaded'
/** Whether a skinned object is an instanced skinned object playing a clip baked into the scene's
 *  animation banks on the GPU (`SkinnedInstanceSettings`): `true` every default, `false` (the
 *  default) a skinned object its host's clips move, or the settings naming its clip and how it
 *  plays (`SKINNED_INSTANCE_SETTINGS`). */
export const SKINNED_INSTANCE_SETTING = 'skinnedInstance'
/** The settings an object may name, `objectSettings` and each of its rules. */
export const OBJECT_SETTINGS = [SPATIALLY_LOADED_SETTING, SKINNED_INSTANCE_SETTING] as const
/** The settings of an instanced skinned object: `clip`, the animation it plays — its rank in the
 *  document or its name —; `looping`, whether its track wraps or holds its last pose; `playRate`,
 *  the seconds of the clip a second plays; `position`, the second it starts from; `boundsScale`,
 *  the scale of its sampled bounds about their centre; `animationMinScreenSize`, the screen size
 *  under which it is drawn in its rest pose — 0 the run-time setting `animationMinScreenSize`, a
 *  negative value never —; `mobility`, `static` or `stationary` making it HLOD-relevant, `movable`
 *  not. */
export const SKINNED_INSTANCE_SETTINGS = [
  'clip',
  'looping',
  'playRate',
  'position',
  'boundsScale',
  'animationMinScreenSize',
  'mobility',
] as const
/** An object streams on the main grid unless a setting says otherwise: the reference's default. */
export const DEFAULT_SPATIALLY_LOADED = true
/** An instanced skinned object's track loops unless a setting says otherwise: the reference's
 *  default. */
export const DEFAULT_BANK_LOOPING = true
/** An instanced skinned object plays its clip at its own pace unless a setting says otherwise:
 *  the reference's default. */
export const DEFAULT_BANK_PLAY_RATE = 1
/** An instanced skinned object starts its clip at its first second unless a setting says
 *  otherwise: the reference's default. */
export const DEFAULT_BANK_POSITION = 0
/** An instanced skinned object's sampled bounds are kept as sampled unless a setting scales them:
 *  the reference's default. */
export const DEFAULT_BANK_BOUNDS_SCALE = 1
/** An instanced skinned object follows the run-time setting `animationMinScreenSize` unless a
 *  setting names its own: the reference's default, 0. */
export const DEFAULT_OBJECT_ANIMATION_MIN_SCREEN_SIZE = 0
/** The mobilities an instanced skinned object may name: `static` and `stationary` make it
 *  HLOD-relevant — `stationary` taken as `static` —, `movable` keeps it out of every HLOD. */
export const OBJECT_MOBILITIES = ['static', 'stationary', 'movable'] as const
/** An instanced skinned object's mobility. */
export type ObjectMobility = (typeof OBJECT_MOBILITIES)[number]
/** An instanced skinned object is movable unless a setting says otherwise: the reference's default
 *  for a component. */
export const DEFAULT_OBJECT_MOBILITY = 'movable' satisfies ObjectMobility
/** The frames a second a bank samples its clips at and its tracks play them at: the reference's. */
export const ANIMATION_BANK_SAMPLE_RATE = 30
/** An instanced skinned object's settings as the compiler reads them, each left out when not
 *  named; the clip by rank or by name. */
export type SkinnedInstanceWire = {
  clip?: number | string
  looping?: boolean
  playRate?: number
  position?: number
  boundsScale?: number
  animationMinScreenSize?: number
  mobility?: ObjectMobility
}
/** One source's object settings as the compiler reads them, each left out when not named. */
export type ObjectSettingsWire = {
  spatiallyLoaded?: boolean
  skinnedInstance?: boolean | SkinnedInstanceWire
}
/** The object settings as the compiler reads them (`resolveObjectSettings` writes them). */
export type ObjectSettingsJobWire = ObjectSettingsWire & {
  objects?: (ObjectSettingsWire & { match: HlodWireMatch })[]
}
