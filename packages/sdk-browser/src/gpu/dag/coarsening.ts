import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The share of the list a raised cut aims to fill: the law may err by a factor 2 before it
 *  overflows again. */
const COARSE_FILL = 1 / 2
/** The coarsest factor: under the law it divides the ranks by 2³², so a cut still past the list
 *  there is made of its roots and cell stand-ins alone, which no threshold coarsens further. */
const COARSEST = 2 ** 16
/** A view whose cut asks more or less than this share of what it asked at its factor's first
 *  fitting cut has clearly changed: its own threshold is tried again. */
const CHANGED = 1 / 8

/** What a view's factor follows: the factor its projected-error threshold is cut under, the list it
 *  was set for, and what the first cut that fitted under it asked (0: none yet). */
export type Coarsening = { factor: number; cap: number; held: number }

/** A view's factor before its first readout: its own threshold. */
export const createCoarsening = (): Coarsening => ({ factor: 1, cap: 0, held: 0 })

/**
 * THE FACTOR A VIEW'S THRESHOLD IS CUT UNDER, past what one binding lists, after a readout cut
 * under `c.factor` that asked `demand` ranks (`listCap.ts`, `listDemand`) of a list of `cap`;
 * `past`: it overflowed a list that cannot grow (`grownListCap`). True when the factor moved.
 *
 * A cut at threshold τ keeps clusters of about τ² pixels, so its ranks follow D(f) = D(1)/f² under
 * τ·f: past, the factor rises to where the cut fills `COARSE_FILL` of the list — √2 at least,
 * `COARSEST` at most. Only an overflow raises it. The way down cannot trust the law — the levels
 * are steps, and a camera that backs away may ask more at a coarse threshold while its own cut
 * fits —, so it reads nothing off it: once the view clearly changed since its factor's first
 * fitting cut (`CHANGED`), its own threshold is tried again; an overflow there counts its ranks
 * exactly and raises the factor back. A still view never tries twice: no image after image flips,
 * and a view that moves pays one cut again per clear change at most. A list grown since releases
 * the factor. Below the device's list the factor stays 1: the view's own threshold.
 */
export function coarsenAfter(c: Coarsening, demand: number, cap: number, past: boolean) {
  const f = c.factor,
    grown = c.cap > 0 && cap > c.cap,
    changed = f > 1 && c.held > 0 && !past && Math.abs(demand - c.held) > CHANGED * c.held
  c.cap = cap
  if (grown || changed) {
    Object.assign(c, { factor: 1, held: 0 })
    return f !== 1
  }
  if (past) {
    c.held = 0
    c.factor = clamp(f * Math.sqrt(demand / (COARSE_FILL * cap)), f * Math.SQRT2, COARSEST)
    return c.factor !== f
  }
  if (f > 1 && !c.held) c.held = demand
  return false
}
