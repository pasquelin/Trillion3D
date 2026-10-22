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
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { MOTION_BLUR_RULES } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { BLOOM_RULES } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import { FILM_RULES } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { TESSELLATION_RULES } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import { SCREEN_PROBE_RULES } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { REFLECTION_RULES } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
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
/** The entry of one setting of a contract's rules (`SettingRule`), of the view distance's group
 *  unless `of` names another: its kind, default and range or names the rule's. A number `above` its
 *  range's start lies from the smallest number past it. */
function ruleEntry(rule: SettingRule, of: QualityGroup) {
  const group = base(of)
  if (rule.kind === 'flag') return { kind: rule.kind, default: rule.default, ...group }
  if (rule.kind === 'choice')
    return { kind: rule.kind, default: rule.default, choices: rule.choices, ...group }
  const range = rule.above ? ([Number.MIN_VALUE, rule.range[1]] as const) : rule.range
  return { kind: rule.kind, default: rule.default, range, ...group }
}
/** The entries of the settings of a contract's rules by field, each setting by its field, in the
 *  quality group `of`: the view distance's, but the sun's shadows (`SHADOW_RULES`) in the shadows'. */
const ruleEntries = <R extends Readonly<Record<string, SettingRule>>>(
  rules: R,
  of: QualityGroup = 'viewDistance',
) =>
  Object.fromEntries(
    Object.entries(rules).map(([field, rule]) => [field, ruleEntry(rule, of)]),
  ) as unknown as { [F in keyof R]: RuleEntry<R[F]['default']> }

/** The rules of every setting declared by rule, by field: the cluster raster's, the geometry
 *  streaming's, the partition's streaming and the HLOD warm-up's, the cut's, the animation's, the
 *  shading's, the exposure's, the temporal pass's — the view distance's group; the sun's shadows
 *  (`SHADOW_RULES`) are the shadows' group's. Both the table below and `RULE_FIELDS` read these
 *  objects, so no table is listed twice. */
const RULES = {
  ...RASTER_RULES,
  ...STREAMING_RULES,
  ...WORLD_STREAMING_RULES,
  ...CUT_RULES,
  ...ANIMATION_RULES,
  ...SHADING_RULES,
  ...EXPOSURE_RULES,
  ...TEMPORAL_RULES,
  ...TESSELLATION_RULES,
}

/** Every render setting of the engine, by name. The settings declared by rule (`RULES`) are read at
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
  ...ruleEntries(RULES),
  // The sun's shadow distance, its far-shadow culling: the shadows' group, whose levels write the
  // distance's scale (`quality.ts`).
  ...ruleEntries(SHADOW_RULES, 'shadows'),
  // The motion blur's quality, its gathers and passes: the image effects' group, whose levels
  // write the quality and the half-resolution gather (`quality.ts`).
  ...ruleEntries(MOTION_BLUR_RULES, 'imageEffects'),
  // The depth of field's quality, gather, scatter and recombine settings: the image effects' group too,
  // whose levels write the ones the reference's levels write (`quality.ts`).
  ...ruleEntries(DEPTH_OF_FIELD_RULES, 'imageEffects'),
  // The bloom's quality, cross, convolution resolution and two switches: the image effects' group
  // too, whose levels write the quality and the resolution (`quality.ts`).
  ...ruleEntries(BLOOM_RULES, 'imageEffects'),
  // The Gaussian blur's fast threshold, sample scale and loop mode (the bloom's levels and the local
  // exposure's blur): the image effects' group too, whose levels write the first two (`quality.ts`).
  ...ruleEntries(GAUSSIAN_BLUR_RULES, 'imageEffects'),
  // The film effects' settings: the image effects' group too, whose levels write the tonemapper's
  // quality and the colour fringe's (`quality.ts`).
  ...ruleEntries(FILM_RULES, 'imageEffects'),
  // The volumetric fog's quality level and its eleven other settings: the shadows' group too,
  // whose levels write the quality (`quality.ts`).
  ...ruleEntries(VOLUMETRIC_FOG_RULES, 'shadows'),
  // The screen probes' level and settings: the indirect light's group, whose levels write the
  // probes' level (`quality.ts`).
  ...ruleEntries(SCREEN_PROBE_RULES, 'indirectLight'),
  // The screen-space ambient occlusion's settings: the image effects' group too, whose levels
  // write its resolutions, ceiling, depth-pyramid climb and radius scale (`quality.ts`).
  ...ruleEntries(AMBIENT_OCCLUSION_RULES, 'imageEffects'),
  // The reflections' trace: the indirect light's group too; the reference's scalability rows write
  // none of its settings, so no level does (`quality.ts`).
  ...ruleEntries(REFLECTION_RULES, 'indirectLight'),
} as const satisfies Readonly<Record<string, RenderSettingEntry>>

/** The fields of every setting declared by rule: no quality level writes one unless its table
 *  lists it (`quality.ts`). */
export const RULE_FIELDS: ReadonlySet<string> = new Set([
  ...Object.keys(RULES),
  ...Object.keys(SHADOW_RULES),
  ...Object.keys(VOLUMETRIC_FOG_RULES),
  ...Object.keys(MOTION_BLUR_RULES),
  ...Object.keys(DEPTH_OF_FIELD_RULES),
  ...Object.keys(BLOOM_RULES),
  ...Object.keys(GAUSSIAN_BLUR_RULES),
  ...Object.keys(FILM_RULES),
  ...Object.keys(SCREEN_PROBE_RULES),
  ...Object.keys(AMBIENT_OCCLUSION_RULES),
  ...Object.keys(REFLECTION_RULES),
])

/** A world's registry over the engine's settings. */
export const createWorldSettings = () => createRenderSettings(WORLD_SETTINGS)
/** A world's settings registry. */
export type WorldSettings = ReturnType<typeof createWorldSettings>
