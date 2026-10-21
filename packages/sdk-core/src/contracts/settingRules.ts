import { refusal } from './nameMatch.ts'

/**
 * The one typing and the one reading of the engine's run-time settings a family declares by rule:
 * the geometry streaming (`./streamingOptions.ts`), the cluster raster (`./rasterOptions.ts`), the
 * partition's streaming and the HLOD warm-up (`./worldStreamingOptions.ts`), the cut
 * (`./cutOptions.ts`), the animation (`./animationOptions.ts`), the material shading
 * (`./shadingOptions.ts`). Each setting is a rule (`SettingRule`) — its kind, its field, its
 * default, the reference's, and, a number, its range, a choice, the names it takes — built by
 * `flagSetting`, `numberSetting`, `integerSetting`, `positiveSetting`, `nonNegativeSetting`,
 * `countSetting` or `choiceSetting`, so its default's type is its value's: a switch a boolean, a number a number, a
 * choice one of its names. The compiler's mesh build (`./meshBuildAbi.ts`) declares its settings
 * the same way, its refusals naming what a rule takes (`settingFits`, `settingTakes`).
 * A family's rules by field (`rulesOf`) type every surface that holds its settings: a host's
 * options (`SettingOptions`), the values resolved (`SettingValues`), the session's context, which
 * extends those options. A setting is read (`readSetting`, or by a runtime's context
 * `contextReader`) and written (`writeSetting`) by its field through them, its value's type
 * following the field, whatever else the holder holds; a group of them all at once
 * (`resolveSettings`, `resolveSettingsInto`). `resolveSetting` is the one reading of a value: one
 * the rule takes as itself, `undefined` or `null` its default, anything else refused with a
 * `TypeError` naming the field and the values it takes.
 */

/** The range a number setting takes, both ends included. */
export type SettingRange = readonly [number, number]
/** One setting: its kind — the render settings' (`../runtime/renderSettings.ts`) —, its field, its
 *  default — the reference's — and, a number, its range; a choice, the names it takes. A number
 *  `above` its range's start excludes it, and `takes` says in words what it takes where the range
 *  does not. */
export type SettingRule =
  | { readonly kind: 'flag'; readonly field: string; readonly default: boolean }
  | {
      readonly kind: 'int' | 'float'
      readonly field: string
      readonly default: number
      readonly range: SettingRange
      readonly above?: true
      readonly takes?: string
    }
  | {
      readonly kind: 'choice'
      readonly field: string
      readonly default: string
      readonly choices: readonly string[]
    }
/** Settings by a name: the one their reader gives them, or their field. */
type SettingRules = Readonly<Record<string, SettingRule>>
/** The values of `T`'s settings, by the names `T` gives them, every one named. */
export type SettingValues<T extends SettingRules> = { -readonly [K in keyof T]: T[K]['default'] }
/** `T`'s rules by their field. */
export type RulesByField<T extends SettingRules> = {
  readonly [K in keyof T as T[K]['field']]: T[K]
}
/** The settings of the rules by field `R` as a host writes them: each its value, or nothing for its
 *  default. */
export type SettingOptions<R extends SettingRules> = { [F in keyof R]?: R[F]['default'] | null }
/** The settings of the rules `T` — by any names — as a host writes them, by their fields. */
type FieldOptions<T extends SettingRules> = {
  [K in keyof T as T[K]['field']]?: T[K]['default'] | null
}

/** Any finite number. */
export const ANY_NUMBER: SettingRange = [-1.7976931348623157e308, 1.7976931348623157e308]

/** A switch of field `field` and default `value`. */
export const flagSetting = <F extends string>(field: F, value: boolean) =>
  ({ kind: 'flag', field, default: value }) as const
/** A number of field `field`, default `value`, within `range`. */
export const numberSetting = <F extends string>(field: F, value: number, range: SettingRange) =>
  ({ kind: 'float', field, default: value, range }) as const
/** A whole number of field `field`, default `value`, within `range`. */
export const integerSetting = <F extends string>(field: F, value: number, range: SettingRange) =>
  ({ kind: 'int', field, default: value, range }) as const
/** A finite number above zero of field `field` and default `value`, `takes` its words. */
export const positiveSetting = <F extends string>(field: F, value: number, takes: string) =>
  ({
    kind: 'float',
    field,
    default: value,
    range: [0, Number.MAX_VALUE],
    above: true,
    takes,
  }) as const
/** A finite number of at least zero of field `field` and default `value`. */
export const nonNegativeSetting = <F extends string>(field: F, value: number) =>
  ({
    kind: 'float',
    field,
    default: value,
    range: [0, Number.MAX_VALUE],
    takes: 'a finite number of at least 0',
  }) as const
/** A whole number of at least `least` of field `field` and default `value`: a count. */
export const countSetting = <F extends string>(field: F, value: number, least: 0 | 1) =>
  ({
    kind: 'int',
    field,
    default: value,
    range: [least, Number.MAX_SAFE_INTEGER],
    takes: `a whole number of at least ${least}`,
  }) as const
/** A choice of field `field`, default `value`, among the names `choices`. */
export const choiceSetting = <F extends string, const C extends readonly string[]>(
  field: F,
  value: C[number],
  choices: C,
) => ({ kind: 'choice', field, default: value, choices }) as const

/** The rules `rules` list, by their field. */
export const rulesOf = <const T extends readonly SettingRule[]>(rules: T) =>
  Object.fromEntries(rules.map((rule) => [rule.field, rule])) as {
    readonly [R in T[number] as R['field']]: R
  }

/** What `rule` takes, in words. */
export function settingTakes(rule: SettingRule) {
  if (rule.kind === 'flag') return 'true or false'
  if (rule.kind === 'choice') return `one of ${rule.choices.map((name) => `'${name}'`).join(', ')}`
  return (
    rule.takes ??
    `${rule.kind === 'int' ? 'a whole number' : 'a number'} from ${rule.range[0]} to ${rule.range[1]}`
  )
}

/**
 * The value `option` names of the setting `rule`: one it takes as itself, `undefined` or `null`
 * its default. The one reading of every setting declared by rule.
 * @throws TypeError naming the field and the values it takes when it is none of them.
 */
export function resolveSetting<R extends SettingRule>(
  rule: R,
  option?: R['default'] | null,
): R['default'] {
  if (option === undefined || option === null) return rule.default
  if (!settingFits(rule, option))
    refusal(rule.field)(`must be ${settingTakes(rule)}, got ${String(option)}`)
  return option
}

/** Whether `value` is one `rule` takes: a switch a boolean, a number a finite one in its range,
 *  whole when it is, a choice one of its names. */
export function settingFits(rule: SettingRule, value: unknown) {
  if (rule.kind === 'flag') return typeof value === 'boolean'
  if (rule.kind === 'choice') return typeof value === 'string' && rule.choices.includes(value)
  const [low, high] = rule.range
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (rule.kind === 'float' || Number.isInteger(value)) &&
    (rule.above ? value > low : value >= low) &&
    value <= high
  )
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
export function writeSetting<R extends SettingRules, F extends keyof R>(
  rules: R,
  options: SettingOptions<R>,
  field: F,
  option?: R[F]['default'] | null,
) {
  options[field] = resolveSetting(rules[field], option)
}

/** The writer of the settings of the rules by field `rules` into `options`, `before` run ahead of
 *  each write: `write(field, option)` is `writeSetting`, the session's setter of a family. */
export const settingWriter =
  <R extends SettingRules>(rules: R, options: SettingOptions<R>, before?: () => void) =>
  <F extends keyof R>(field: F, option: R[F]['default'] | null | undefined) => {
    before?.()
    writeSetting(rules, options, field, option)
  }

/** Each group's rules in their order, read once: a frame's reading allocates no list. */
const entries = new WeakMap<SettingRules, readonly (readonly [string, SettingRule])[]>()

/** Every setting of `rules` read from `options` by its field (`resolveSetting`), each its default
 *  when they hold none, by the name `rules` give it — its field for rules by field —, written in
 *  `into`, which is returned: a reading each frame reuses one object. */
export function resolveSettingsInto<T extends SettingRules>(
  rules: T,
  options: FieldOptions<T>,
  into: SettingValues<T>,
) {
  let named = entries.get(rules)
  if (!named) entries.set(rules, (named = Object.entries(rules)))
  const held = options as Readonly<Record<string, boolean | number | string | null | undefined>>
  const out = into as Record<string, boolean | number | string>
  for (const [name, rule] of named) out[name] = resolveSetting(rule, held[rule.field])
  return into
}

/** Every setting of `rules` read from `options`, in a new object (`resolveSettingsInto`). */
export const resolveSettings = <T extends SettingRules>(rules: T, options: FieldOptions<T>) =>
  resolveSettingsInto(rules, options, {} as SettingValues<T>)
