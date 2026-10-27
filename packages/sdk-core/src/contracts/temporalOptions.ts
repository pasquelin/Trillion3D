import {
  choiceSetting as choice,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  contextReader,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of the temporal pass beside its level (`temporalAntialiasing`,
 * `./materialOptions.ts`): whether it resurrects, reprojects by a field and widens its shading
 * rejection by the flicker measure — each the level's by default —, whether it looks for geometry
 * thinner than a pixel, how many frames its resurrection keeps for good and how often it stores
 * one, the speed from which the reprojection field anti-aliases its edges, the samples its history holds, keeps after a
 * rejection and keeps while it moves, the flicker measure's period, and the thresholds of the thin
 * geometry detection. Run-time settings, as `./settingRules.ts` says: the level is the scene's,
 * written in its manifest, while these are the engine's own, read again at each image. What a
 * level sets (the history's resolution, the formats, the update's quality, the anti-aliaser, the
 * flicker rejection, the resurrection, the reprojection field) stays the level's alone.
 */

/** What a setting that rides on the level takes: `'level'`, the default, leaves the choice to the level
 *  (`TAA_LEVEL_KNOBS`, `post/taa/levels.ts`), `'on'` and `'off'` say it whatever the level. */
const FOLLOWS_LEVEL = ['level', 'on', 'off'] as const

/** The shading rejection's modes: `'responsive'`, more responsiveness and less ghosting but more blocky
 *  artifacts, and `'stability'`, better stability and shading rejection control but more ghosting. */
const SHADING_REJECTION_MODES = ['responsive', 'stability'] as const

/** The shading ranges the thin geometry detection counts as thin geometry, by the number the measure reads. */
export const THIN_GEOMETRY_SHADING_RANGES = ['foliage', 'foliageAndHair', 'all', 'varying'] as const

/** The temporal pass's settings by field, each with the reference's default:
 *  `temporalResurrection`, `temporalReprojectionField` and `temporalShadingRejectionFlickering`,
 *  `'level'` — whether the history keeps older frames to bring a pixel's detail back after a
 *  disocclusion, whether it reprojects by a vector, its jacobian and a boundary rather than the
 *  dilated vector alone, and whether the shading rejection widens by the flicker measure: the
 *  reference makes each a setting of its own whose default the quality level writes (low: none;
 *  medium: the resurrection; high and max: all three), so `'level'` takes the level's value and
 *  `'on'` or `'off'` the setting's own, at any level that runs the pass —;
 *  `temporalThinGeometry`, off — whether the pass looks for geometry thinner than a pixel, a wire
 *  or a rail the pixels it crosses see on some images and not on others, and relaxes the history's
 *  clamp where it finds it, at the cost of the finding in every image, at any level that runs the
 *  pass; `temporalResurrectionFrames`, 2 — the frames the resurrection keeps for good, beside the
 *  last two, rounded up to an even count —, which costs a history's bytes each;
 *  `temporalResurrectionInterval`, 31 — the images between two stored for good, made odd —;
 *  `temporalReprojectionFieldSpeed`, 0.125 — the speed, in display pixels an image, from which the
 *  reprojection field anti-aliases its dilation by the depth. The last three apply where the pass
 *  resurrects and reprojects by a field. `temporalWaveOps`, true — whether the pass's
 *  programs that gather over a tile run through the lanes of a subgroup instead of workgroup
 *  memory, where the device grants subgroups and runs them at a size the programs are written for
 *  (`post/taa/waveOps.ts`) —, and `temporalWaveSize`, 0 — the lanes a subgroup holds in those
 *  programs, 16, 32 or 64, 0 the device's smallest size from 16 — are read when the pass is made
 *  and at each image: another choice compiles the programs it names, off the frame.
 *  `temporalHalfPrecision`, true — whether the programs that have a 16-bit float variant (the spatial
 *  anti-aliaser's) run in it, where the device grants 16-bit shader floats; else, or where it does
 *  not, in 32 bits. `temporalHistoryPacked`, true — whether the history keeps its colour in the
 *  11-11-10 format where the device stores to it, four bytes a pixel; `false`, half floats, eight
 *  bytes: the cinematic preset's value. Read when the pass is made, and made again when it changes.
 *
 *  `temporalShadingRejectionMode`, `'stability'` — whether the clamp of the flicker measure (the
 *  rejection that finds the texels that oscillate, `temporalShadingRejectionFlickering`) widens by the
 *  blur of the lesser total variation of the input's change and of the input (`'responsive'`, which
 *  rejects less and ghosts less, with blockier artifacts) or not (`'stability'`, steadier and with
 *  more control of the rejection, with more ghosting) —; it applies where the flicker measure runs.
 *
 *  THE HISTORY'S SAMPLES, each in samples of a display pixel but the velocity's, which are a history
 *  pixel's: `temporalHistorySampleCount`, 16 — the most a display pixel's history holds, 8 to 32,
 *  higher steadier on highlights of a still image, more ghosting on fireflies —;
 *  `temporalShadingRejectionSampleCount`, 2 — the most it keeps after a total shading rejection,
 *  lower clearer after a rejection but less steady —; `temporalVelocityWeightClampingSampleCount`,
 *  4 — the samples a history pixel keeps once its pixel moves at `temporalVelocityWeightClampingPixelSpeed`,
 *  1 — half display pixels an image, the motion vector spanning two per image —, more steadier on a
 *  movement and more blurred.
 *
 *  THE FLICKER MEASURE, where the pass runs it (`temporalShadingRejectionFlickering`): `temporalFlickeringPeriod`, 2 — the images in which a
 *  luma oscillation of that frequency or more is a flicker to ghost, 0 running no measure —;
 *  `temporalFlickeringAdjustToFrameRate`, true — whether the period shortens in proportion where the
 *  frame rate falls below `temporalFlickeringFrameRateCap`, 60 hertz, so an effect animated in time
 *  is not taken for a flicker —; `temporalFlickeringMaxParallaxVelocity`, 10 — the parallax speed, in
 *  pixels of a 1080p image at that frame rate, past which a texel is moving, not flickering.
 *  `temporalShadingExposureOffset`, 0 — stops added to the exposure the shading rejection measures the
 *  colours at, -20 to 20.
 *
 *  THE THIN GEOMETRY DETECTION, where it runs (`temporalThinGeometry`): `temporalThinGeometryErrorMultiplier`,
 *  200 — the depth step, in pixel depth errors at a twentieth of it, past which a texel stands out
 *  as a thin line —; `temporalThinGeometryMinKeepLineContrast`, 0.3 — the luma contrast past which a
 *  texel stands out as a thin line of light —; `temporalThinGeometryLineFadeRate`, 0.1, and
 *  `temporalThinGeometryLineFadeRateInsideRegion`, 0.03 — how often a high contrast line not seen again
 *  fades, outside and inside a cluster hole region, 0 never, 1 at once —;
 *  `temporalThinGeometryLineWeight`, 0.6 — the relaxation weight of a high contrast line where no
 *  cluster relaxes the history —; `temporalThinGeometryMaxRelaxationWeight`, 0.037 — the greatest
 *  weight by which a cluster hole region relaxes the history, before the 3×3 average that spreads it —;
 *  `temporalThinGeometryRejectTranslucency`, 0.6 — the share of a texel's
 *  luma that the translucent layers make, past which its thin geometry is rejected, 0 never;
 *  `temporalThinGeometryShadingRange`, `'varying'` — the shading models that count as thin geometry
 *  (`THIN_GEOMETRY_SHADING_RANGES`): `'foliage'` the two-sided foliage alone, `'foliageAndHair'` it and
 *  the hair, `'all'` every lit surface, `'varying'` every lit surface, the foliage relaxed with the
 *  dilation and the others by their edge alone — which needs the flicker measure running
 *  (`temporalShadingRejectionFlickering` on, `temporalFlickeringPeriod` above 0) or
 *  `temporalThinGeometryMinKeepLineContrast` above 0, else it counts the foliage alone;
 *  `temporalThinGeometryAntiFlickering`, true — whether the flicker measure considers the relaxation
 *  the detection gives the history, since the detection can fail (false, it measures the flicker as
 *  if the history were not relaxed).
 *
 *  THE HALF-SIZE IMAGE the exposure and the bloom read: `temporalDownsampleQuality`, `'low'` — `'low'`
 *  has the passes that write the image beside their own, the temporal pass and the motion blur, write
 *  it too, one filtered sample of the four pixels a texel covers, and only the chain's own pass where
 *  neither draws; `'high'` has the chain's pass draw it alone, four filtered samples of the 4 × 4
 *  pixels around a texel. */
export const TEMPORAL_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('temporalResurrection', 'level', FOLLOWS_LEVEL),
    choice('temporalReprojectionField', 'level', FOLLOWS_LEVEL),
    choice('temporalShadingRejectionFlickering', 'level', FOLLOWS_LEVEL),
    choice('temporalShadingRejectionMode', 'stability', SHADING_REJECTION_MODES),
    flag('temporalThinGeometry', false),
    count('temporalResurrectionFrames', 2, 1),
    count('temporalResurrectionInterval', 31, 1),
    nonNegative('temporalReprojectionFieldSpeed', 0.125),
    flag('temporalWaveOps', true),
    integer('temporalWaveSize', 0, [0, 64]),
    flag('temporalHalfPrecision', true),
    flag('temporalHistoryPacked', true),
    number('temporalHistorySampleCount', 16, [8, 32]),
    nonNegative('temporalShadingRejectionSampleCount', 2),
    nonNegative('temporalVelocityWeightClampingSampleCount', 4),
    positive(
      'temporalVelocityWeightClampingPixelSpeed',
      1,
      'a finite number of half display pixels an image above 0',
    ),
    nonNegative('temporalFlickeringPeriod', 2),
    flag('temporalFlickeringAdjustToFrameRate', true),
    positive('temporalFlickeringFrameRateCap', 60, 'a finite number of hertz above 0'),
    positive(
      'temporalFlickeringMaxParallaxVelocity',
      10,
      'a finite number of 1080p pixels an image above 0',
    ),
    number('temporalShadingExposureOffset', 0, [-20, 20]),
    nonNegative('temporalThinGeometryErrorMultiplier', 200),
    number('temporalThinGeometryMinKeepLineContrast', 0.3, [0, 1]),
    number('temporalThinGeometryLineFadeRate', 0.1, [0, 1]),
    number('temporalThinGeometryLineFadeRateInsideRegion', 0.03, [0, 1]),
    number('temporalThinGeometryLineWeight', 0.6, [0, 1]),
    number('temporalThinGeometryMaxRelaxationWeight', 0.037, [0, 1]),
    number('temporalThinGeometryRejectTranslucency', 0.6, [0, 1]),
    choice('temporalThinGeometryShadingRange', 'varying', THIN_GEOMETRY_SHADING_RANGES),
    flag('temporalThinGeometryAntiFlickering', true),
    choice('temporalDownsampleQuality', 'low', ['low', 'high']),
  ] as const))()
/** The temporal pass setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readTemporalSetting = /* @__PURE__ */ contextReader(TEMPORAL_RULES)
/** The field of one setting of the temporal pass. */
export type TemporalField = keyof typeof TEMPORAL_RULES
/** The temporal pass's settings resolved: every field its value. */
export type TemporalValues = SettingValues<typeof TEMPORAL_RULES>
/** The temporal pass's settings at their defaults: the values of a pass that is told none. */
export const TEMPORAL_DEFAULTS: TemporalValues = /* @__PURE__ */ resolveSettings(TEMPORAL_RULES, {})
/** The temporal pass's settings as a host writes them, by their fields: each its value, or nothing
 *  for its default. */
export type TemporalOptions = SettingOptions<typeof TEMPORAL_RULES>
