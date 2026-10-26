import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  TEMPORAL_RULES,
  type TemporalOptions,
} from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { resolveSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'

/** A level the pass runs at: any but off. */
type TaaRunningLevel = Exclude<TemporalAntialiasingLevel, 'off'>

/** Whether `level` runs the pass: any but off — the one reading of a level's on and off. */
export const isTaaLevelOn = (level: TemporalAntialiasingLevel): level is TaaRunningLevel =>
  level !== 'off'

/** The analysis a level runs (`analysis.ts`): the flicker measure where the rejection widens by
 *  it, the spatial anti-aliaser where it browses any sample, the thin geometry detection where the
 *  history is relaxed by it (`temporalThinGeometry`, `temporalOptions.ts`). */
export interface AnalysisWork {
  readonly flicker: boolean
  readonly antiAlias: boolean
  readonly thin: boolean
}
/** Every pass of the analysis, an analysis view's whatever the level (`taaViewCode`). */
export const FULL_ANALYSIS: AnalysisWork = { flicker: true, antiAlias: true, thin: true }
/** The analysis of a level running the flicker measure and the spatial anti-aliaser as asked: the
 *  thin geometry detection off (`work`), the reference's default — it relaxes the history only
 *  where geometry is thinner than a pixel, and costs every image the finding of where —, and on
 *  (`thinWork`). */
const analysisOf = (flicker: boolean, antiAlias: boolean) => ({
  work: { flicker, antiAlias, thin: false },
  thinWork: { flicker, antiAlias, thin: true },
})

/** What a temporal anti-aliasing level sets in the pass (`TaaView.quality`, `bindingsWgsl.ts`):
 *  whether the shading rejection widens by the flicker measure (`flicker`), how many bilinear
 *  samples the spatial anti-aliaser browses each side of an edge, none leaving it off and the
 *  history update's kernel unshifted (`antiAliasIterations`), and whether the history update's
 *  kernel moves its far neighbour toward the corner the display pixel lies by (`movesFar`), else a
 *  plus of five texels; the history's resolution in percent of the display's, 100 to 200
 *  (`historyPercent`); whether it keeps older frames to bring a pixel's detail back after a
 *  disocclusion (`resurrection`); whether it reprojects by a field — a vector, its jacobian and a
 *  boundary — instead of the dilated vector alone (`reprojectionField`); the analysis it runs
 *  (`work`), and the same with the thin geometry detection on (`thinWork`). */
export interface TaaLevelKnobs {
  readonly flicker: boolean
  readonly antiAliasIterations: number
  readonly movesFar: boolean
  readonly historyPercent: number
  readonly resurrection: boolean
  readonly reprojectionField: boolean
  readonly work: AnalysisWork
  readonly thinWork: AnalysisWork
}

/**
 * The anti-aliasing scalability levels, `low` to `max` the levels 0 to 3:
 * - `low`: the plus kernel, no spatial anti-aliaser — a history update of the lowest quality runs
 *   none —, no flicker rejection, no resurrection, no reprojection field;
 * - `medium`: the plus kernel, the spatial anti-aliaser's three samples a side, no flicker
 *   rejection, the history's resurrection;
 * - `high`: the kernel moving its far neighbour, three samples a side, the flicker rejection, the
 *   resurrection and the reprojection field;
 * - `max`: the same with eight samples a side and a history at twice the display's resolution —
 *   four samples a history pixel, still 16 a display pixel (`historySampleLaws`) —, resolved down
 *   to the display's.
 * Every level here keeps its history colour in the 11-11-10 format where the device stores to it
 * (`historyFormatsOf`, `historyShape.ts`); the cinematic preset turns `temporalHistoryPacked` off.
 */
export const TAA_LEVEL_KNOBS: Readonly<Record<TaaRunningLevel, TaaLevelKnobs>> = {
  low: {
    flicker: false,
    antiAliasIterations: 0,
    movesFar: false,
    historyPercent: 100,
    resurrection: false,
    reprojectionField: false,
    ...analysisOf(false, false),
  },
  medium: {
    flicker: false,
    antiAliasIterations: 3,
    movesFar: false,
    historyPercent: 100,
    resurrection: true,
    reprojectionField: false,
    ...analysisOf(false, true),
  },
  high: {
    flicker: true,
    antiAliasIterations: 3,
    movesFar: true,
    historyPercent: 100,
    resurrection: true,
    reprojectionField: true,
    ...analysisOf(true, true),
  },
  max: {
    flicker: true,
    antiAliasIterations: 8,
    movesFar: true,
    historyPercent: 200,
    resurrection: true,
    reprojectionField: true,
    ...analysisOf(true, true),
  },
}

/** The settings that ride on the level (`temporalOptions.ts`): each `'level'`, `'on'` or `'off'`, or
 *  none for the level's. */
type TaaKnobSettings = Pick<
  TemporalOptions,
  'temporalResurrection' | 'temporalReprojectionField' | 'temporalShadingRejectionFlickering'
>

/** The knobs a level and its settings made, by the settings' bits, held: the same object each
 *  image, so what compares knobs by identity (`createShapeMemo`) sees no change. */
const derivedKnobs = new WeakMap<TaaLevelKnobs, Map<number, TaaLevelKnobs>>()

/** The value a setting that rides on the level gives a knob: the level's `held` for `'level'`. */
const choiceOf = (choice: string, held: boolean) => (choice === 'level' ? held : choice === 'on')

/** The knobs of `level`, a setting that is not `'level'` overriding the level's resurrection,
 *  reprojection field or flicker rejection — the analysis a flicker rejection runs following it —;
 *  `'off'` runs no pass, and reads as the finest level, whose knobs a pass rigged before it was
 *  switched off keeps. */
export function taaKnobs(
  level: TemporalAntialiasingLevel,
  settings: TaaKnobSettings = {},
): TaaLevelKnobs {
  const base = TAA_LEVEL_KNOBS[isTaaLevelOn(level) ? level : 'max']
  const resurrection = choiceOf(
      resolveSetting(TEMPORAL_RULES.temporalResurrection, settings.temporalResurrection),
      base.resurrection,
    ),
    reprojectionField = choiceOf(
      resolveSetting(TEMPORAL_RULES.temporalReprojectionField, settings.temporalReprojectionField),
      base.reprojectionField,
    ),
    flicker = choiceOf(
      resolveSetting(
        TEMPORAL_RULES.temporalShadingRejectionFlickering,
        settings.temporalShadingRejectionFlickering,
      ),
      base.flicker,
    )
  if (
    resurrection === base.resurrection &&
    reprojectionField === base.reprojectionField &&
    flicker === base.flicker
  )
    return base
  const bits = Number(resurrection) | (Number(reprojectionField) << 1) | (Number(flicker) << 2)
  let made = derivedKnobs.get(base)
  if (!made) derivedKnobs.set(base, (made = new Map()))
  let knobs = made.get(bits)
  if (!knobs)
    made.set(
      bits,
      (knobs = {
        ...base,
        resurrection,
        reprojectionField,
        flicker,
        work: { ...base.work, flicker },
        thinWork: { ...base.thinWork, flicker },
      }),
    )
  return knobs
}
