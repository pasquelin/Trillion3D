/**
 * A compile job's object settings as a host names them, and the functions that turn them into the
 * form the compiler reads (`compiler/args/objects.rs`, `ObjectSettings::read`).
 *
 * `objectSettings` sets, for every object of the scene, the settings of `OBJECT_SETTINGS`:
 * - `spatiallyLoaded`: the object streams on the partition's main grid, drawn while the view lies
 *   within the grid's loading range of its cell — `true` by default, the reference's for every
 *   object —, or is loaded with the scene and always drawn (`false`). An animated object — skinned,
 *   morphed, or moved by a clip itself or through a parent — streams too, and no HLOD stands for it
 *   past its cell's range;
 * - `skinnedInstance`: the skinned object plays a clip baked into the scene's animation banks on
 *   the GPU, every instance of one clip, mesh and settings in one pose (`SkinnedInstanceSettings`)
 *   — `true` every default, `false` (the default) a skinned object its host's clips move.
 * - `drawDistance`: the nearest and the farthest distance from the eye the object is drawn at, in
 *   the scene's units, tested on the centre of its bounds (`DrawDistanceSettings`) — `false` (the
 *   default) none: it is drawn at every distance. The cut applies it (`cutDrawDistanceCulling`,
 *   `cutOptions.ts`).
 * - `runtimeGrid`: the name of the streaming grid the object streams on (`partitionGrids`) — the
 *   first grid when it names none or one the job does not hold, the reference's rule; an object
 *   attached under another streams on its topmost object's grid.
 * - `farField`: the object is drawn by a view's primed depth (`hizPrime`), `false` by default.
 * Its `objects` are rules `{ match, …settings }`, `match` naming objects as `meshBuild` does: each
 * sets its settings for the objects it matches. For each setting of an object, the first that
 * names it wins: the first rule matching it, the scene's setting, its node's own glTF `extras`
 * under the setting's name, the default. A job naming none compiles as before, its cache key kept.
 * A value left out or `null` names nothing, as the compiler reads it.
 */
import {
  DEFAULT_DRAW_DISTANCE_MAX,
  DRAW_DISTANCE_SETTING,
  DRAW_DISTANCE_SETTINGS,
  OBJECT_MOBILITIES,
  OBJECT_SETTINGS,
  OBJECT_SETTINGS_FIELD,
  OBJECT_SETTINGS_OBJECTS,
  OBJECT_SETTINGS_OPTION,
  PARTITION_GRID_NAME_FORBIDDEN,
  RUNTIME_GRID_SETTING,
  FAR_FIELD_SETTING,
  SKINNED_INSTANCE_SETTING,
  SKINNED_INSTANCE_SETTINGS,
  SPATIALLY_LOADED_SETTING,
  type DrawDistanceWire,
  type ObjectMobility,
  type ObjectSettingsJobWire,
  type ObjectSettingsWire,
  type SkinnedInstanceWire,
} from './compilerAbi.ts'
import { isFiniteNumber as finite } from '../../../math/src/scalar/reals.ts'
import { isGridName } from './partitionGridOptions.ts'
import {
  fieldsOf,
  isRecord,
  jsonJobOption,
  resolveByObject,
  type NameMatch,
  type NamePattern,
  type Refuse,
} from './nameMatch.ts'

/** How an instanced skinned object plays its clip, each the default when left out. */
export type SkinnedInstanceSettings = {
  /** The animation it plays: its rank in the document, or its name. @defaultValue the first
   *  animation that moves a joint of its skin */
  clip?: number | string
  /** Whether its track wraps at its end, or holds its last pose. @defaultValue true */
  looping?: boolean
  /** The seconds of the clip one second plays. @defaultValue 1 */
  playRate?: number
  /** The second of the clip it starts from, from 0 to the clip's length. @defaultValue 0 */
  position?: number
  /** The scale of its sampled bounds about their centre, above 0: room for vertices the joints
   *  carry out of them. @defaultValue 1 */
  boundsScale?: number
  /** The screen size — its bounds' diameter over the view's height — under which it is drawn in its
   *  rest pose: 0 the run-time setting `animationMinScreenSize`, a negative value never.
   *  @defaultValue 0 */
  animationMinScreenSize?: number
  /** `static` or `stationary` makes it HLOD-relevant — its cell's HLOD 0 actor plays it on —,
   *  `movable` keeps it out of every HLOD. @defaultValue 'movable' */
  mobility?: ObjectMobility
}

/** An object's skinned instance: `true` every default, `false` none, or its settings. */
export type SkinnedInstanceOption = boolean | SkinnedInstanceSettings

/** The distances an object is drawn at, from the eye to the centre of its bounds, in the scene's
 *  units. */
export type DrawDistanceSettings = {
  /** The distance under which the object is not drawn. @defaultValue 0 */
  min?: number
  /** The distance past which the object is not drawn: 0 none, the object is drawn at every
   *  distance, whatever its `min`. @defaultValue 0 */
  max?: number
}

/** One source's object settings, each the next source's, or its default, when left out. */
export type ObjectSettings = {
  /** Whether the object streams on the main grid. @defaultValue true */
  spatiallyLoaded?: boolean
  /** Whether a skinned object plays a baked clip on the GPU, and how. @defaultValue false */
  skinnedInstance?: SkinnedInstanceOption
  /** The distances the object is drawn at: `false` none, it is drawn at every distance, or its
   *  `min` and `max`. @defaultValue false */
  drawDistance?: false | DrawDistanceSettings
  /** The name of the streaming grid it streams on (`partitionGrids`), not empty.
   *  @defaultValue the first grid */
  runtimeGrid?: string
  /** Whether a view's primed depth draws the object. @defaultValue false */
  farField?: boolean
}

/** A rule of `objects`: the objects it names — a node's name (exact), a regular expression on it,
 *  or a match on what the glTF carries (`NameMatch`) — and the settings it sets for them. */
export type ObjectRule = ObjectSettings & { match: NamePattern | NameMatch }

/** The object settings: the scene's, and the rules setting them by object, the first wins. */
export type ObjectSettingsOption = ObjectSettings & { objects?: readonly ObjectRule[] }

/** What a distance, or a position in a clip, takes. */
const NON_NEGATIVE: [string, (v: unknown) => boolean] = [
  'a finite number of at least 0',
  (value) => finite(value) && value >= 0,
]

/** What each setting of an instanced skinned object takes, as a refusal names it, and whether a
 *  value is one of them. */
const SKINNED_TAKES: Record<
  (typeof SKINNED_INSTANCE_SETTINGS)[number],
  [string, (v: unknown) => boolean]
> = {
  clip: [
    'a whole number from 0 or an animation name',
    (value) => typeof value === 'string' || (Number.isInteger(value) && (value as number) >= 0),
  ],
  looping: ['true or false', (value) => typeof value === 'boolean'],
  playRate: ['a finite number', finite],
  position: NON_NEGATIVE,
  boundsScale: ['a finite number above 0', (value) => finite(value) && value > 0],
  animationMinScreenSize: ['a finite number', finite],
  mobility: [
    `one of ${OBJECT_MOBILITIES.join(', ')}`,
    (value) => (OBJECT_MOBILITIES as readonly unknown[]).includes(value),
  ],
}

/** What each key of a draw distance takes. */
const DRAW_DISTANCE_TAKES: Record<
  (typeof DRAW_DISTANCE_SETTINGS)[number],
  [string, (v: unknown) => boolean]
> = {
  min: NON_NEGATIVE,
  max: NON_NEGATIVE,
}

/** The settings of `keys` the object `value` names, each read as its `takes` entry says and a
 *  refusal naming it under `what`; the ones left out or null are not in the wire. */
function recordOf<K extends string>(
  value: unknown,
  keys: readonly K[],
  takes: Record<K, [string, (v: unknown) => boolean]>,
  what: string,
  refuse: Refuse,
) {
  const named = fieldsOf(value, keys, what, refuse)
  const wire: Record<string, unknown> = {}
  for (const name of keys) {
    const setting = named[name]
    if (setting === undefined || setting === null) continue
    const [words, fits] = takes[name]
    if (!fits(setting)) refuse(`${what}.${name} must be ${words}, got ${JSON.stringify(setting)}`)
    wire[name] = setting
  }
  return wire
}

/** The skinned instance `value` names, as the compiler reads it, `what` naming it in a refusal. */
function skinnedOf(value: unknown, what: string, refuse: Refuse): boolean | SkinnedInstanceWire {
  if (typeof value === 'boolean') return value
  if (!isRecord(value))
    refuse(`${what} must be true, false or an object of ${SKINNED_INSTANCE_SETTINGS.join(', ')}`)
  const wire = recordOf(value, SKINNED_INSTANCE_SETTINGS, SKINNED_TAKES, what, refuse)
  return wire as SkinnedInstanceWire
}

/** The draw distance `value` names, as the compiler reads it, `what` naming it in a refusal: `false`
 *  none, or an object of `min` and `max`, each a finite number of at least 0. An object whose `max`
 *  is left out or 0 names no farthest distance: it is `false` too, one form for none. */
function drawDistanceOf(value: unknown, what: string, refuse: Refuse): false | DrawDistanceWire {
  if (value === false) return false
  if (!isRecord(value))
    refuse(`${what} must be false or an object of ${DRAW_DISTANCE_SETTINGS.join(', ')}`)
  const wire = recordOf(value, DRAW_DISTANCE_SETTINGS, DRAW_DISTANCE_TAKES, what, refuse)
  return ((wire.max as number | undefined) ?? DEFAULT_DRAW_DISTANCE_MAX) > 0
    ? (wire as DrawDistanceWire)
    : false
}

/** The settings of `named` the compiler reads, `what` naming them in a refusal. */
function settingsOf(named: Record<string, unknown>, what: string, refuse: Refuse) {
  const wire: ObjectSettingsWire = {}
  const loaded = named[SPATIALLY_LOADED_SETTING]
  if (loaded !== undefined && loaded !== null) {
    if (typeof loaded !== 'boolean')
      refuse(
        `${what}${SPATIALLY_LOADED_SETTING} must be true or false, got ${JSON.stringify(loaded)}`,
      )
    wire.spatiallyLoaded = loaded as boolean
  }
  const skinned = named[SKINNED_INSTANCE_SETTING]
  if (skinned !== undefined && skinned !== null)
    wire.skinnedInstance = skinnedOf(skinned, `${what}${SKINNED_INSTANCE_SETTING}`, refuse)
  const drawn = named[DRAW_DISTANCE_SETTING]
  if (drawn !== undefined && drawn !== null)
    wire.drawDistance = drawDistanceOf(drawn, `${what}${DRAW_DISTANCE_SETTING}`, refuse)
  const far = named[FAR_FIELD_SETTING]
  if (far !== undefined && far !== null) {
    if (typeof far !== 'boolean')
      refuse(`${what}${FAR_FIELD_SETTING} must be true or false, got ${JSON.stringify(far)}`)
    wire.farField = far as boolean
  }
  const grid = named[RUNTIME_GRID_SETTING]
  if (grid !== undefined && grid !== null) {
    if (!isGridName(grid))
      refuse(
        `${what}${RUNTIME_GRID_SETTING} must be the name of a streaming grid, a text with none of ` +
          `${PARTITION_GRID_NAME_FORBIDDEN}, got ${JSON.stringify(grid)}`,
      )
    wire.runtimeGrid = grid
  }
  return wire
}

/**
 * The object settings the compiler reads for `option`: none when left out.
 * @param option - The scene's settings and the rules by object, or none.
 * @returns The compiler's form (`ObjectSettingsJobWire`), `undefined` for none.
 * @throws TypeError naming the setting and what it takes, or the rule, when one is wrong.
 */
export function resolveObjectSettings(
  option?: ObjectSettingsOption | null,
): ObjectSettingsJobWire | undefined {
  if (option === undefined || option === null) return undefined
  return resolveByObject(
    option,
    OBJECT_SETTINGS_FIELD,
    OBJECT_SETTINGS,
    OBJECT_SETTINGS_OBJECTS,
    settingsOf,
  )
}

/** A job's `objectSettings` as the job field and the command line's flag the compiler reads
 *  (`jsonJobOption`): `fields` left out, `flags` none, when the job names none. */
export const objectSettingsJob = jsonJobOption(
  OBJECT_SETTINGS_FIELD,
  OBJECT_SETTINGS_OPTION,
  resolveObjectSettings,
)
