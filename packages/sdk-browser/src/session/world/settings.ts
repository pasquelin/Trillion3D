/**
 * The engine's render settings (`../../../../sdk-core/src/runtime/renderSettings.ts`): each default
 * is the constant the engine reads today, referenced, never copied. A switch with no constant of
 * its own defaults to what the engine does without it: the pass drawn, the bounce on.
 */
import { DEFAULT_PIXEL_ERROR } from '../../../../sdk-core/src/lod/policy.ts'
import {
  DEFAULT_TEMPORAL_AA_LEVEL,
  TEMPORAL_AA_LEVELS,
} from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  SETTING_FAMILIES,
  type FamilyRules,
  type FamilyTable,
  type RegistryRule,
} from '../../../../sdk-core/src/runtime/settingFamilies.ts'
import type { UnionToIntersection } from '../../../../sdk-core/src/runtime/joined.ts'
import {
  createRenderSettings,
  type ChoiceSettingEntry,
  type FlagSettingEntry,
  type NumberSettingEntry,
  type QualityGroup,
  type RenderSettingEntry,
} from '../../../../sdk-core/src/runtime/renderSettings.ts'

/** Who may write a setting: by default anyone. */
const base = (group: QualityGroup, editorOnly = false) => ({ group, editorOnly })
const flag = (value: boolean, group: QualityGroup) => ({
  kind: 'flag' as const,
  default: value,
  ...base(group),
})

/** The entry of a setting whose value is `V`: a switch, a number, or a choice of names. */
type RuleEntry<V> = V extends boolean
  ? FlagSettingEntry
  : V extends number
    ? NumberSettingEntry
    : Omit<ChoiceSettingEntry, 'default' | 'choices'> & { default: V; choices: readonly V[] }
/** The entry of one setting of a contract's rules (`RegistryRule`), of the quality group `quality`
 *  (the view distance's by default): its kind, default and range or names the rule's. A number `above` its range's start lies from
 *  the smallest number past it. */
function ruleEntry(rule: RegistryRule, quality: QualityGroup = 'viewDistance') {
  const group = base(quality)
  if (rule.kind === 'flag') return { kind: rule.kind, default: rule.default, ...group }
  if (rule.kind === 'choice')
    return { kind: rule.kind, default: rule.default, choices: rule.choices, ...group }
  const range = rule.above ? ([Number.MIN_VALUE, rule.range[1]] as const) : rule.range
  return { kind: rule.kind, default: rule.default, range, ...group }
}
/** The entries of a family's rules `R`, each setting by its field. */
type RuleEntries<R extends FamilyRules> = { [F in keyof R]: RuleEntry<R[F]['default']> }
/** The entries of the settings of a contract's rules by field, each setting by its field. */
const ruleEntries = <R extends FamilyRules>(rules: R, group?: QualityGroup) =>
  Object.fromEntries(
    Object.entries(rules).map(([field, rule]) => [field, ruleEntry(rule, group)]),
  ) as unknown as RuleEntries<R>

/** The entries of every family of `T` at once: all the settings of the table, each by its field. */
type FamilyEntries<T extends FamilyTable> = UnionToIntersection<
  { [N in keyof T]: RuleEntries<T[N]['rules']> }[keyof T]
>
/** The entries of the settings of every family of `table`, each in the quality group the family
 *  names (`SettingFamily.group`), or, where it spreads over several, in the one each of its rules
 *  belongs to (`SettingFamily.groups`). */
function familyEntries<T extends FamilyTable>(table: T) {
  const entries: Record<string, unknown> = {}
  for (const { group, groups, rules } of Object.values(table))
    for (const [named, own] of Object.entries(groups ?? { [group as QualityGroup]: rules }))
      Object.assign(entries, ruleEntries(own as FamilyRules, named as QualityGroup))
  return entries as FamilyEntries<T>
}

/** Every render setting of the engine, by name. The settings declared by rule (`SETTING_FAMILIES`) are read at
 *  each frame, or at each update of the streaming, from the session's context; the view distance's
 *  levels write one of them, the scale of the objects' draw distances (`cutViewDistanceScale`), as
 *  the reference's scalability groups do, and no level writes the others. */
const WORLD_SETTINGS = {
  // Wired: the world applies them (`switches.ts`).
  pixelError: {
    kind: 'float',
    default: DEFAULT_PIXEL_ERROR,
    range: [0, Number.MAX_VALUE],
    ...base('viewDistance'),
  },
  // The temporal anti-aliasing's level, `'off'` none (`../../post/taa/levels.ts`): its hook keeps the
  // history unless the flicker rejection turns on (`setWebgpuTemporalAntialiasing`).
  antialiasing: {
    kind: 'choice',
    default: DEFAULT_TEMPORAL_AA_LEVEL,
    choices: TEMPORAL_AA_LEVELS,
    ...base('edgeSmoothing'),
  },
  bounce: flag(true, 'indirectLight'),
  // Every family declared by rule (`SETTING_FAMILIES`), each in the quality group whose levels write it
  // (`quality.ts`): the view distance's, the shadows', the image effects', the indirect light's, and the
  // sky's over three.
  ...familyEntries(SETTING_FAMILIES),
} as const satisfies Readonly<Record<string, RenderSettingEntry>>

/** The fields of every setting declared by rule: no quality level writes one unless its table
 *  lists it (`quality.ts`). */
export const RULE_FIELDS: ReadonlySet<string> = new Set(
  Object.values(SETTING_FAMILIES).flatMap((family) => Object.keys(family.rules)),
)

/** A world's registry over the engine's settings; over the families of `table` where it is not the
 *  engine's own (`SETTING_FAMILIES`). */
export const createWorldSettings = (table: FamilyTable = SETTING_FAMILIES) =>
  createRenderSettings(
    table === SETTING_FAMILIES
      ? WORLD_SETTINGS
      : ({ ...WORLD_SETTINGS, ...familyEntries(table) } as unknown as typeof WORLD_SETTINGS),
  )
/** A world's settings registry. */
export type WorldSettings = ReturnType<typeof createWorldSettings>
