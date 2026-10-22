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
import { RASTER_RULES } from '../../../../sdk-core/src/contracts/rasterOptions.ts'
import { STREAMING_RULES } from '../../../../sdk-core/src/contracts/streamingOptions.ts'
import { WORLD_STREAMING_RULES } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { SettingRule } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { CUT_RULES } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { ANIMATION_RULES } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import { SHADING_RULES } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
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
/** The entry of one setting of a contract's rules (`SettingRule`), of the view distance's group:
 *  its kind, default and range or names the rule's. A number `above` its range's start lies from
 *  the smallest number past it. */
function ruleEntry(rule: SettingRule) {
  const group = base('viewDistance')
  if (rule.kind === 'flag') return { kind: rule.kind, default: rule.default, ...group }
  if (rule.kind === 'choice')
    return { kind: rule.kind, default: rule.default, choices: rule.choices, ...group }
  const range = rule.above ? ([Number.MIN_VALUE, rule.range[1]] as const) : rule.range
  return { kind: rule.kind, default: rule.default, range, ...group }
}
/** The entries of the settings of a contract's rules by field, each setting by its field. */
const ruleEntries = <R extends Readonly<Record<string, SettingRule>>>(rules: R) =>
  Object.fromEntries(
    Object.entries(rules).map(([field, rule]) => [field, ruleEntry(rule)]),
  ) as unknown as { [F in keyof R]: RuleEntry<R[F]['default']> }

/** The rules of every setting declared by rule, by field: the cluster raster's, the geometry
 *  streaming's, the partition's streaming and the HLOD warm-up's, the cut's, the animation's, the
 *  shading's, the exposure's, the temporal pass's. Both the table below and `RULE_FIELDS` read this
 *  one object, so no table is listed twice. */
const RULES = {
  ...RASTER_RULES,
  ...STREAMING_RULES,
  ...WORLD_STREAMING_RULES,
  ...CUT_RULES,
  ...ANIMATION_RULES,
  ...SHADING_RULES,
  ...EXPOSURE_RULES,
  ...TEMPORAL_RULES,
}

/** Every render setting of the engine, by name. The settings declared by rule (`RULES`) are read at
 *  each frame, or at each update of the streaming, from the session's context; no level of the view
 *  distance's writes them, as the reference's scalability groups leave every one at its default. */
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
  ...ruleEntries(RULES),
} as const satisfies Readonly<Record<string, RenderSettingEntry>>

/** The fields of every setting declared by rule: no quality level writes one unless its table
 *  lists it (`quality.ts`). */
export const RULE_FIELDS: ReadonlySet<string> = new Set(Object.keys(RULES))

/** A world's registry over the engine's settings. */
export const createWorldSettings = () => createRenderSettings(WORLD_SETTINGS)
/** A world's settings registry. */
export type WorldSettings = ReturnType<typeof createWorldSettings>
