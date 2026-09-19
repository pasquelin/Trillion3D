/**
 * The two measurement tools of the path governor (`mathPathGovernor.ts`): the fineness of
 * the thread clock, and the sliding median it arbitrates on. Nothing here knows
 * paths or operations.
 */

/** Executions retained per path: the median then follows a minute of play, not a frame. */
const PATH_WINDOW = 30;
/**
 * Clock resolution beyond which no arbitration is attempted. An engine batch lasts
 * tenths of a millisecond: a coarser clock than that yields only zeros and jumps,
 * from which no median comes. This is not a machine constant, it is the order of magnitude of
 * what is measured.
 */
export const CLOCK_RESOLUTION_MS = 0.1;
/** Clock reads used to estimate its resolution: enough to see the smallest step. */
const CLOCK_PROBES = 32;

/**
 * The smallest non-zero gap between two successive reads of `now`, in milliseconds. A
 * deliberately truncated clock yields it as-is; `null` if no read has moved.
 */
export function estimateClockResolutionMs(now: () => number) {
  let plusPetit: number | null = null;
  let precedent = now();
  for (let i = 0; i < CLOCK_PROBES; i++) {
    const courant = now();
    const pas = courant - precedent;
    if (pas > 0 && (plusPetit === null || pas < plusPetit)) plusPetit = pas;
    precedent = courant;
  }
  return plusPetit;
}

/** A sliding median over the last `PATH_WINDOW` values, with no allocation per execution. */
export class Fenetre {
  private readonly valeurs = new Float64Array(PATH_WINDOW);
  private readonly triee = new Float64Array(PATH_WINDOW);
  private prochain = 0;
  count = 0;
  ajoute(valeur: number) {
    this.valeurs[this.prochain] = valeur;
    this.prochain = (this.prochain + 1) % PATH_WINDOW;
    if (this.count < PATH_WINDOW) this.count++;
  }
  mediane() {
    if (!this.count) return null;
    const { triee, valeurs, count } = this;
    for (let i = 0; i < count; i++) triee[i] = valeurs[i];
    triee.subarray(0, count).sort();
    const milieu = count >> 1;
    return count % 2 ? triee[milieu] : (triee[milieu - 1] + triee[milieu]) / 2;
  }
}
