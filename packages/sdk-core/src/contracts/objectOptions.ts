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
 * Its `objects` are rules `{ match, …settings }`, `match` naming objects as `meshBuild` does: each
 * sets its settings for the objects it matches. For each setting of an object, the first that
 * names it wins: the first rule matching it, the scene's setting, its node's own glTF `extras`
 * under the setting's name, the default. A job naming none compiles as before, its cache key kept.
 * A value left out or `null` names nothing, as the compiler reads it.
 */
import {
  OBJECT_MOBILITIES,
  OBJECT_SETTINGS,
  OBJECT_SETTINGS_FIELD,
  OBJECT_SETTINGS_OBJECTS,
  OBJECT_SETTINGS_OPTION,
  SKINNED_INSTANCE_SETTING,
  SKINNED_INSTANCE_SETTINGS,
  SPATIALLY_LOADED_SETTING,
  type ObjectMobility,
  type ObjectSettingsJobWire,
  type ObjectSettingsWire,
  type SkinnedInstanceWire,
} from './compilerAbi.ts'
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

/** One source's object settings, each the next source's, or its default, when left out. */
export type ObjectSettings = {
  /** Whether the object streams on the main grid. @defaultValue true */
  spatiallyLoaded?: boolean
  /** Whether a skinned object plays a baked clip on the GPU, and how. @defaultValue false */
  skinnedInstance?: SkinnedInstanceOption
}

/** A rule of `objects`: the objects it names — a node's name (exact), a regular expression on it,
 *  or a match on what the glTF carries (`NameMatch`) — and the settings it sets for them. */
export type ObjectRule = ObjectSettings & { match: NamePattern | NameMatch }

/** The object settings: the scene's, and the rules setting them by object, the first wins. */
export type ObjectSettingsOption = ObjectSettings & { objects?: readonly ObjectRule[] }

/** A finite number. */
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

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
  position: ['a finite number of at least 0', (value) => finite(value) && value >= 0],
  boundsScale: ['a finite number above 0', (value) => finite(value) && value > 0],
  animationMinScreenSize: ['a finite number', finite],
  mobility: [
    `one of ${OBJECT_MOBILITIES.join(', ')}`,
    (value) => (OBJECT_MOBILITIES as readonly unknown[]).includes(value),
  ],
}

/** The skinned instance `value` names, as the compiler reads it, `what` naming it in a refusal. */
function skinnedOf(value: unknown, what: string, refuse: Refuse): boolean | SkinnedInstanceWire {
  if (typeof value === 'boolean') return value
  if (!isRecord(value))
    refuse(`${what} must be true, false or an object of ${SKINNED_INSTANCE_SETTINGS.join(', ')}`)
  const named = fieldsOf(value, SKINNED_INSTANCE_SETTINGS, what, refuse)
  const wire: Record<string, unknown> = {}
  for (const name of SKINNED_INSTANCE_SETTINGS) {
    const setting = named[name]
    if (setting === undefined || setting === null) continue
    const [takes, fits] = SKINNED_TAKES[name]
    if (!fits(setting)) refuse(`${what}.${name} must be ${takes}, got ${JSON.stringify(setting)}`)
    wire[name] = setting
  }
  return wire as SkinnedInstanceWire
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
