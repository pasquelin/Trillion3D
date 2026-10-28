import { refusal } from './nameMatch.ts'
import { isFiniteNumber } from '../../../math/src/scalar/reals.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'

/**
 * The one typing and the one reading of the engine's run-time settings a family declares by rule:
 * the geometry streaming (`./streamingOptions.ts`), the cluster raster (`./rasterOptions.ts`), the
 * partition's streaming and the HLOD warm-up (`./worldStreamingOptions.ts`), the cut
 * (`./cutOptions.ts`), the animation (`./animationOptions.ts`), the material shading
 * (`./shadingOptions.ts`), the automatic and the local exposure (`./exposureOptions.ts`), the
 * temporal pass (`./temporalOptions.ts`). Each setting is a rule (`SettingRule`) — its kind, its
 * field, its default, the reference's, and, a number, its range, a choice, the names it takes —
 * built by `flagSetting`, `numberSetting`, `integerSetting`, `vectorSetting`, `positiveSetting`, `nonNegativeSetting`,
 * `countSetting` or `choiceSetting`, so its default's type is its value's: a switch a boolean, a
 * number a number, a choice one of its names. The compiler's mesh build (`./meshBuildAbi.ts`)
 * declares its settings the same way, its refusals naming what a rule takes (`settingFits`,
 * `settingTakes`). A family's rules by field (`rulesOf`) type every surface that holds its
 * settings: a host's options (`SettingOptions`), the values resolved (`SettingValues`), the
 * session's context, which extends those options. A setting is read (`readSetting`, or by a
 * runtime's context `contextReader`) and written (`writeSetting`) by its field through them, its
 * value's type following the field, whatever else the holder holds; a group of them all at once
 * (`resolveSettings`, `resolveSettingsInto`), two readings of them compared (`settingsDiffer`).
 * `resolveSetting` is the one reading of a value: one the rule takes as itself, `undefined` or
 * `null` its default, anything else refused with a `TypeError` naming the field and the values it
 * takes.
 *
 * RUN-TIME SETTINGS. The families this reads are the engine's own, read again at each frame,
 * or at each update of the streaming: no compiler job names them, so no manifest carries them and
 * no cache key holds them. Only the cut's view distance scale has quality levels
 * (`VIEW_DISTANCE_SCALE_LEVELS`): the scalability groups of the reference leave every other one at
 * its default, so a quality preset writes none (`../runtime/qualityLevels.ts`). Each
 * is a world option (`WorldOptions`), a session option (`MeasuredWorldOptions`), a render setting
 * of the view distance's group (`packages/sdk-browser/src/session/world/settings.ts`), and the LLM
 * schemas name it by its field and say what it means (`../llm/settingProperties.ts`). Each is read
 * by `resolveSetting` wherever it is taken — the world, a session at its opening, the session's
 * setter, the frame or the streaming's update.
 */

/** The range a number setting takes, both ends included. */
export type SettingRange = readonly [number, number]
/** One setting: its kind — the render settings' (`../runtime/renderSettings.ts`) —, its field, its
 *  default — the reference's — and, a number, its range; a choice, the names it takes. A number
 *  `above` its range's start excludes it, `excluding` takes one value out of its range (zero, where
 *  a quotient would divide by it), `distance` makes it a distance in metres that also takes `true`,
 *  its default, and `false`, none (0: `distanceSetting`), and `takes` says in words what it takes
 *  where the range does not. */
export type SettingRule =
  | { readonly kind: 'flag'; readonly field: string; readonly default: boolean }
  | {
      readonly kind: 'int' | 'float'
      readonly field: string
      readonly default: number
      readonly range: SettingRange
      readonly above?: true
      readonly excluding?: number
      readonly distance?: true
      readonly takes?: string
    }
  | {
      readonly kind: 'choice'
      readonly field: string
      readonly default: string
      readonly choices: readonly string[]
    }
  | { readonly kind: 'vector'; readonly field: string; readonly default: readonly number[] }
/** Settings by a name: the one their reader gives them, or their field. */
export type SettingRules = Readonly<Record<string, SettingRule>>
/** The values of `T`'s settings, by the names `T` gives them, every one named. */
export type SettingValues<T extends SettingRules> = { -readonly [K in keyof T]: T[K]['default'] }
/** `T`'s rules by their field. */
export type RulesByField<T extends SettingRules> = {
  readonly [K in keyof T as T[K]['field']]: T[K]
}
/** What a LEVEL rule — a choice whose first name is `'off'` — takes besides its names: a switch, `true` its
 *  default level, `false` `'off'` (the reference's anti-aliasing option reads its levels so); none for any other. */
type LevelSwitch<R> = R extends {
  readonly kind: 'choice'
  readonly choices: readonly ['off', ...string[]]
}
  ? boolean
  : never
/** What a DISTANCE rule (`distanceSetting`) takes besides its metres: a switch, `true` its default
 *  distance, `false` none, 0; none for any other. */
type DistanceSwitch<R> = R extends { readonly distance: true } ? boolean : never
/** The settings of the rules by field `R` as a host writes them: each its value, or nothing for its
 *  default. */
export type SettingOptions<R extends SettingRules> = {
  [F in keyof R]?: R[F]['default'] | LevelSwitch<R[F]> | DistanceSwitch<R[F]> | null
}
/** The settings of the rules `T` — by any names — as a host writes them, by their fields. */
type FieldOptions<T extends SettingRules> = {
  [K in keyof T as T[K]['field']]?:
    T[K]['default'] | LevelSwitch<T[K]> | DistanceSwitch<T[K]> | null
}

/** Any finite number. */
export const ANY_NUMBER: SettingRange = [-1.7976931348623157e308, 1.7976931348623157e308]
/** Any whole number a signed 32-bit word holds. */
/** The largest 32-bit signed whole number, a constant of its own: a bundle drops what reads only it. */
export const INT32_MAX = 2147483647
export const INT32_RANGE: SettingRange = [-2147483648, INT32_MAX]

/** The range of a finite number from `low` up. */
export const atLeast = (low: number): SettingRange => [low, ANY_NUMBER[1]]

/** A switch of field `field` and default `value`. */
export const flagSetting = <F extends string>(field: F, value: boolean) =>
  ({ kind: 'flag', field, default: value }) as const
/** A number of field `field`, default `value`, within `range`. */
export const numberSetting = <F extends string>(field: F, value: number, range: SettingRange) =>
  ({ kind: 'float', field, default: value, range }) as const
/** A whole number of field `field`, default `value`, within `range`. */
export const integerSetting = <F extends string>(field: F, value: number, range: SettingRange) =>
  ({ kind: 'int', field, default: value, range }) as const
/** The range of a finite number of at least zero. */
const FROM_ZERO = /* @__PURE__ */ atLeast(0)
/** A number of field `field` and default `value`, whole when `kind` is `int`, within `range` —
 *  its start excluded when `above` —, `takes` its words: the one builder of the settings below. */
const bounded = <F extends string, K extends 'int' | 'float'>(
  kind: K,
  field: F,
  value: number,
  range: SettingRange,
  takes: string,
  above = false,
) => ({ kind, field, default: value, range, takes, ...(above && { above: true as const }) })
/** A finite number but zero of field `field` and default `value`, `takes` its words: a scale the
 *  engine divides by, which may be negative where the reference lets it. */
export const nonZeroSetting = <F extends string>(field: F, value: number, takes: string) => ({
  ...bounded('float', field, value, ANY_NUMBER, takes),
  excluding: 0,
})
/** A finite number above zero of field `field` and default `value`, `takes` its words. */
export const positiveSetting = <F extends string>(
  field: F,
  value: number,
  takes = 'a finite number above 0',
) => bounded('float', field, value, FROM_ZERO, takes, true)
/** A distance in metres of field `field` and default `value`: a finite number of at least 0, which
 *  also takes `true`, the default, and `false`, none (0), the way a light's shadow distance is
 *  written. */
export const distanceSetting = <F extends string>(field: F, value: number) => ({
  ...bounded(
    'float',
    field,
    value,
    FROM_ZERO,
    'a finite number of metres of at least 0, true or false',
  ),
  distance: true as const,
})
/** A finite number of at least zero of field `field` and default `value`, `takes` its words. */
export const nonNegativeSetting = <F extends string>(
  field: F,
  value: number,
  takes = 'a finite number of at least 0',
) => bounded('float', field, value, FROM_ZERO, takes)
/** A whole number of at least `least` of field `field` and default `value`: a count. */
export const countSetting = <F extends string>(field: F, value: number, least: 0 | 1) =>
  bounded(
    'int',
    field,
    value,
    [least, Number.MAX_SAFE_INTEGER],
    `a whole number of at least ${least}`,
  )
/** A choice of field `field`, default `value`, among the names `choices`. */
export const choiceSetting = <F extends string, const C extends readonly string[]>(
  field: F,
  value: C[number],
  choices: C,
) => ({ kind: 'choice', field, default: value, choices }) as const

/** A vector of field `field` whose default `value` fixes its length: finite numbers, a linear
 *  colour (three) as well as a set of coefficients. */
export const vectorSetting = <F extends string>(field: F, value: readonly number[]) =>
  ({ kind: 'vector', field, default: Object.freeze([...value]) }) as const

/** The rules `rules` list, by their field. */
export const rulesOf = <const T extends readonly SettingRule[]>(rules: T) =>
  Object.fromEntries(rules.map((rule) => [rule.field, rule])) as {
    readonly [R in T[number] as R['field']]: R
  }

/** The fields of the rules `rules`, in order. */
export const ruleFields = <T extends SettingRules>(rules: T) =>
  Object.keys(rules) as readonly (keyof T & string)[]

/** Whether `rule` is a level rule: a choice whose first name is `'off'` (`LevelSwitch`). */
const isLevelRule = (rule: SettingRule) => rule.kind === 'choice' && rule.choices[0] === 'off'

/** What `rule` takes, in words. */
export function settingTakes(rule: SettingRule) {
  if (rule.kind === 'flag') return 'true or false'
  if (rule.kind === 'choice')
    return `one of ${rule.choices.map((name) => `'${name}'`).join(', ')}${isLevelRule(rule) ? ', true or false' : ''}`
  if (rule.kind === 'vector') return `an array of ${rule.default.length} finite numbers`
  return (
    rule.takes ??
    `${rule.kind === 'int' ? 'a whole number' : 'a number'} from ${rule.range[0]} to ${rule.range[1]}`
  )
}

/**
 * The value `option` names of the setting `rule`: one it takes as itself, `undefined` or `null`
 * its default; for a level rule (`LevelSwitch`) `true` too is its default and `false` is `'off'`;
 * for a distance rule (`DistanceSwitch`) `true` is its default and `false` is 0. The one reading of
 * every setting declared by rule.
 * @throws TypeError naming the field and the values it takes when it is none of them.
 */
export function resolveSetting<R extends SettingRule>(
  rule: R,
  option?: R['default'] | LevelSwitch<R> | DistanceSwitch<R> | null,
): R['default'] {
  if (option === undefined || option === null) return rule.default
  if (typeof option === 'boolean' && isLevelRule(rule))
    return (option ? rule.default : 'off') as R['default']
  if (typeof option === 'boolean' && rule.kind === 'float' && rule.distance)
    return (option ? rule.default : 0) as R['default']
  if (!settingFits(rule, option))
    refusal(rule.field)(`must be ${settingTakes(rule)}, got ${String(option)}`)
  return Array.isArray(option) ? ([...option] as R['default']) : (option as R['default'])
}

/** The settings of the fields of `rules` that `named` holds, each resolved by its rule
 *  (`resolveSetting`, which refuses one the rule does not take, naming the field); a field left out
 *  or `null` is left out of the result. */
export function resolveNamed(
  rules: Readonly<Record<string, SettingRule>>,
  named: Record<string, unknown>,
) {
  const wire: Record<string, unknown> = {}
  for (const field of Object.keys(rules)) {
    const value = named[field]
    if (value !== undefined && value !== null)
      wire[field] = resolveSetting(rules[field], value as never)
  }
  return wire
}

/** Whether `value` is one `rule` takes: a switch a boolean, a number a finite one in its range,
 *  whole when it is, a choice one of its names. */
export function settingFits(rule: SettingRule, value: unknown) {
  if (rule.kind === 'flag') return typeof value === 'boolean'
  if (rule.kind === 'choice') return typeof value === 'string' && rule.choices.includes(value)
  if (rule.kind === 'vector')
    return (
      Array.isArray(value) && value.length === rule.default.length && value.every(isFiniteNumber)
    )
  const [low, high] = rule.range
  return (
    isFiniteNumber(value) &&
    (rule.kind === 'float' || Number.isInteger(value)) &&
    (rule.above ? value > low : value >= low) &&
    value <= high &&
    value !== rule.excluding
  )
}

/** The `value` a job names for the setting `name` under `rule`, `undefined` where it names none
 *  (left out or `null`); `refuse`d, `name` first, when `rule` does not take it. */
export function namedSetting(
  rule: SettingRule,
  value: unknown,
  name: string,
  refuse: (message: string) => never,
) {
  if (value === undefined || value === null) return undefined
  if (!settingFits(rule, value))
    refuse(`${name} must be ${settingTakes(rule)}, got ${JSON.stringify(value)}`)
  return value
}

/** The setting of field `field` of the rules by field `rules` that `options` hold, resolved
 *  (`resolveSetting`): its default when they hold none. */
export const readSetting = <R extends SettingRules, F extends keyof R>(
  rules: R,
  options: SettingOptions<R>,
  field: F,
): R[F]['default'] => resolveSetting(rules[field], options[field])

/** The reader of the settings of the rules by field `rules` a runtime's context holds: `read(rt,
 *  field)` is `readSetting` of `rt.context`, each frame's one reading of a setting a session
 *  writes in place. */
export const contextReader =
  <R extends SettingRules>(rules: R) =>
  <F extends keyof R>(
    runtime: { readonly context: SettingOptions<R> },
    field: F,
  ): R[F]['default'] =>
    readSetting(rules, runtime.context, field)

/**
 * Writes into `options` the setting of field `field` of the rules by field `rules` that `option`
 * names (`resolveSetting`): its default for `undefined` or `null`.
 * @throws TypeError naming the field and the values it takes when it is none of them.
 */
function writeSetting<R extends SettingRules, F extends keyof R>(
  rules: R,
  options: SettingOptions<R>,
  field: F,
  option?: SettingOptions<R>[F],
) {
  options[field] = resolveSetting(rules[field], option)
}

/** The writer of the settings of the rules by field `rules` into `options`, `before` run ahead of
 *  each write: `write(field, option)` is `writeSetting`, the session's setter of a family. */
export const settingWriter =
  <R extends SettingRules>(rules: R, options: SettingOptions<R>, before?: () => void) =>
  <F extends keyof R>(field: F, option: SettingOptions<R>[F]) => {
    before?.()
    writeSetting(rules, options, field, option)
    settingsWritten()
  }

/** Moves at every write of a tracked context's settings: what a stamped reading is held against. */
let settingsEpoch = 0
/** The contexts whose every write moves `settingsEpoch` (`trackSettings`). */
const tracked = new WeakSet<object>()
/** Names that a write of the settings of a context was made: the epoch moves, stamped readings of
 *  a tracked context are read again. Every writer of a tracked context calls it after its write. */
export const settingsWritten = () => void settingsEpoch++
/**
 * Marks `options` as a context whose settings are written only through `settingWriter` or a writer
 * that calls `settingsWritten`: `resolveSettingsStamped` then reads a rest of them once. Hand it the
 * one context the session writes; an object written by any other means must not be tracked.
 */
export const trackSettings = <T extends object>(options: T) => (tracked.add(options), options)

/** The revision of the settings `options` hold: moves at every write when `options` is tracked
 *  (`trackSettings`), `NaN` — equal to no other — when it is not. What a derived value is held against. */
export const settingsRevision = (options: object) => (tracked.has(options) ? settingsEpoch : NaN)

/** What a stamped object was last read from: its rules, its options and the epoch. */
type Stamp = { rules: SettingRules | undefined; options: object | undefined; epoch: number }
const stamps = new WeakMap<object, Stamp>()

/** One setting's value, whatever its kind. */
export type SettingValue = boolean | number | string | readonly number[]
/** Whether two values of one setting are the same: a vector by its parts. */
export const sameValue = (a: SettingValue, b: SettingValue) =>
  a === b || (typeof a === 'object' && typeof b === 'object' && sameValues(a, b))

/** Each group's rules in their order, read once: a frame's reading allocates no list. */
const entries = new WeakMap<SettingRules, readonly (readonly [string, SettingRule])[]>()
const namedRules = (rules: SettingRules) => {
  let named = entries.get(rules)
  if (!named) entries.set(rules, (named = Object.entries(rules)))
  return named
}

/** Every setting of `rules` read from `options` by its field (`resolveSetting`), each its default
 *  when they hold none, by the name `rules` give it — its field for rules by field —, written in
 *  `into`, which is returned: a reading each frame reuses one object. */
export function resolveSettingsInto<T extends SettingRules>(
  rules: T,
  options: FieldOptions<T>,
  into: SettingValues<T>,
) {
  const held = options as Readonly<Record<string, SettingValue | null | undefined>>
  const out = into as Record<string, SettingValue>
  for (const [name, rule] of namedRules(rules)) out[name] = resolveSetting(rule, held[rule.field])
  return into
}

/** Whether `into` was read now by `resolveSettingsStamped`. */
function readStamped<T extends SettingRules>(
  rules: T,
  options: FieldOptions<T>,
  into: SettingValues<T>,
) {
  let stamp = stamps.get(into)
  if (stamp?.rules === rules && stamp.options === options && stamp.epoch === settingsEpoch)
    return false
  // `into` is about to be overwritten: no stamp may vouch for it until it is read whole (a refusal
  // midway, or a reading of a context not tracked, leaves it as no stamped reading).
  if (stamp) stamp.epoch = NaN
  resolveSettingsInto(rules, options, into)
  if (!tracked.has(options)) return true
  if (stamp) {
    stamp.rules = rules
    stamp.options = options
    stamp.epoch = settingsEpoch
  } else stamps.set(into, { rules, options, epoch: settingsEpoch })
  return true
}

/**
 * `resolveSettingsInto` that reads again only when a write (`settingsWritten`) came since `into`
 * was last read from these rules and this tracked context. `into` is the reader's own and nothing
 * else writes it. An options object not tracked (`trackSettings`) is always read.
 */
export function resolveSettingsStamped<T extends SettingRules>(
  rules: T,
  options: FieldOptions<T>,
  into: SettingValues<T>,
) {
  readStamped(rules, options, into)
  return into
}

/** Whether any setting of `rules` differs between two readings of them (`resolveSettingsInto`),
 *  `used` the one a pass was drawn with and `settings` the one now: what a view that rests asks to
 *  know whether it is drawn again. Nothing is allocated. */
export function settingsDiffer<T extends SettingRules>(
  rules: T,
  used: SettingValues<T>,
  settings: SettingValues<T>,
) {
  const before = used as Record<string, SettingValue>
  const now = settings as Record<string, SettingValue>
  for (const [name] of namedRules(rules)) if (!sameValue(before[name], now[name])) return true
  return false
}

/** Every setting of `rules` read from `options`, in a new object (`resolveSettingsInto`). */
export const resolveSettings = <T extends SettingRules>(rules: T, options: FieldOptions<T>) =>
  resolveSettingsInto(rules, options, {} as SettingValues<T>)

/**
 * The watch of a family's settings a pass keeps beside its own state (`settingsWatch`): `read(options)` reads
 * every setting of `rules` into one object and `moved` then says whether any differs from the last reading
 * that moved — the first reading always does. What a pass that rebuilds its derived values or its resources
 * only when a setting changed asks each image: nothing is resolved twice, nothing allocated past the two
 * objects it holds. `peek(options)` reads them apart, into an object of its own, and takes nothing of
 * the watch: a reader that is not the one the pass is told by — which asks the same rules for another
 * purpose — cannot make the pass miss a change.
 */
export function settingsWatch<T extends SettingRules>(rules: T) {
  const now = {} as SettingValues<T>,
    apart = {} as SettingValues<T>
  let used: SettingValues<T> | undefined
  const watch = {
    /** Whether the last reading differs from the one before it that moved. */
    moved: false,
    /** The settings `options` hold, resolved into one object that the next reading overwrites. */
    read(options: FieldOptions<T>) {
      const fresh = readStamped(rules, options, now)
      watch.moved = !used || (fresh && settingsDiffer(rules, used, now))
      if (watch.moved) used = { ...now }
      return now
    },
    /** The settings `options` hold, resolved into an object the next peek overwrites; `moved` and
     *  what the watch compares to are untouched. */
    peek: (options: FieldOptions<T>) => resolveSettingsStamped(rules, options, apart),
  }
  return watch
}
/** The watch of the settings of the rules `R` (`settingsWatch`): what a pass or a kind keeps beside its state. */
export type SettingsWatch<R extends SettingRules> = ReturnType<typeof settingsWatch<R>>
