import type { TemporalAntialiasingLevel } from '../../../sdk-core/src/contracts/compilerAbi.ts'

/** A level the pass runs at: any but off. */
type TaaRunningLevel = Exclude<TemporalAntialiasingLevel, 'off'>

/** Whether `level` runs the pass: any but off — the one reading of a level's on and off. */
export const isTaaLevelOn = (level: TemporalAntialiasingLevel): level is TaaRunningLevel =>
  level !== 'off'

/** The analysis a level runs (`analysis.ts`): the flicker measure where the rejection widens by
 *  it, the spatial anti-aliaser where it browses any sample. */
export interface AnalysisWork {
  readonly flicker: boolean
  readonly antiAlias: boolean
}
/** Every pass of the analysis: the finest level's, and an analysis view's whatever the level
 *  (`taaViewCode`). */
export const FULL_ANALYSIS: AnalysisWork = { flicker: true, antiAlias: true }

/** What a temporal anti-aliasing level sets in the pass (`TaaView.quality`, `bindingsWgsl.ts`):
 *  whether the shading rejection widens by the flicker measure (`flicker`), how many bilinear
 *  samples the spatial anti-aliaser browses each side of an edge, none leaving it off and the
 *  history update's kernel unshifted (`antiAliasIterations`), and whether the history update's
 *  kernel moves its far neighbour toward the corner the display pixel lies by (`movesFar`), else a
 *  plus of five texels; the analysis it runs (`work`). */
export interface TaaLevelKnobs {
  readonly flicker: boolean
  readonly antiAliasIterations: number
  readonly movesFar: boolean
  readonly work: AnalysisWork
}

/**
 * The anti-aliasing scalability levels, `low` to `max` the levels 0 to 3:
 * - `low`: the plus kernel, no spatial anti-aliaser — a history update of the lowest quality runs
 *   none —, no flicker rejection;
 * - `medium`: the plus kernel, the spatial anti-aliaser's three samples a side, no flicker
 *   rejection;
 * - `high`: the kernel moving its far neighbour, three samples a side, the flicker rejection;
 * - `max`: the same with eight samples a side.
 * Every level keeps the history at the display's resolution, its most samples 16
 * (`historySampleLaws`). What the levels also set and the pass has not: a history at twice the
 * display's resolution on `max` — four samples a history pixel, still 16 a display pixel —, the history's
 * resurrection from medium up, the reprojection field from high up, and an 11-11-10 history below
 * the cinematic level (the pass keeps half floats at every level).
 */
export const TAA_LEVEL_KNOBS: Readonly<Record<TaaRunningLevel, TaaLevelKnobs>> = {
  low: {
    flicker: false,
    antiAliasIterations: 0,
    movesFar: false,
    work: { flicker: false, antiAlias: false },
  },
  medium: {
    flicker: false,
    antiAliasIterations: 3,
    movesFar: false,
    work: { flicker: false, antiAlias: true },
  },
  high: { flicker: true, antiAliasIterations: 3, movesFar: true, work: FULL_ANALYSIS },
  max: { flicker: true, antiAliasIterations: 8, movesFar: true, work: FULL_ANALYSIS },
}

/** The knobs of `level`; `'off'` runs no pass, and reads as the finest level, whose knobs a pass
 *  rigged before it was switched off keeps. */
export const taaKnobs = (level: TemporalAntialiasingLevel): TaaLevelKnobs =>
  TAA_LEVEL_KNOBS[isTaaLevelOn(level) ? level : 'max']
