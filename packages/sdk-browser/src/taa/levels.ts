import type { TemporalAntialiasingLevel } from '../../../sdk-core/src/contracts/compilerAbi.ts'

/** A level the pass runs at: any but off. */
export type TaaRunningLevel = Exclude<TemporalAntialiasingLevel, 'off'>

/** What a temporal anti-aliasing level sets in the pass (`TaaView.quality`, `bindingsWgsl.ts`):
 *  whether the shading rejection widens by the flicker measure (`flicker`), how many bilinear
 *  samples the spatial anti-aliaser browses each side of an edge, none leaving it off and the
 *  history update's kernel unshifted (`antiAliasIterations`), and whether the history update's
 *  kernel moves its far neighbour toward the corner the display pixel lies by (`movesFar`), else a
 *  plus of five texels. */
export interface TaaLevelKnobs {
  readonly flicker: boolean
  readonly antiAliasIterations: number
  readonly movesFar: boolean
}

/**
 * The anti-aliasing scalability levels, `low` to `max` the levels 0 to 3:
 * - `low`: the plus kernel, no spatial anti-aliaser — a history update of the lowest quality runs
 *   none —, no flicker rejection;
 * - `medium`: the plus kernel, the spatial anti-aliaser's three samples a side, no flicker
 *   rejection;
 * - `high`: the kernel moving its far neighbour, three samples a side, the flicker rejection;
 * - `max`: the same with eight samples a side — the engine's image before the levels existed.
 * What the levels also set and the pass has not: a history at twice the display's resolution on
 * `max`, the history's resurrection from medium up, the reprojection field from high up, and an
 * 11-11-10 history below the cinematic level (the pass keeps half floats at every level).
 */
export const TAA_LEVEL_KNOBS: Readonly<Record<TaaRunningLevel, TaaLevelKnobs>> = {
  low: { flicker: false, antiAliasIterations: 0, movesFar: false },
  medium: { flicker: false, antiAliasIterations: 3, movesFar: false },
  high: { flicker: true, antiAliasIterations: 3, movesFar: true },
  max: { flicker: true, antiAliasIterations: 8, movesFar: true },
}
