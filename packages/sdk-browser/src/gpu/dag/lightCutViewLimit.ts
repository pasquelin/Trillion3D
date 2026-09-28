/**
 * The light views one batch draws in, bisected between the most views a batch drew whole and the
 * fewest a batch dropped work with: a drop at `L` views never swings the limit between `L` and
 * `L / 2`, it settles on the largest count that fits, never below one.
 *
 * What dropped depends on the clusters the views kept from the resident catalogue, so a residency
 * change makes the drop stale, never forgotten: the limit stays where it settled (#525 — resetting
 * it to `viewCap` dropped a batch, and redrew its pages in full, at every residency change). Once
 * residency changed, a settled limit probes one view above itself only after `patience` batches
 * at the limit fitted; a probe that fits lifts the limit by that view and the next view up is
 * probed at once, never straight back to a count that dropped before. The first drop after a
 * residency change at or above what fitted — a probe, or a lifted limit, that did not hold —
 * doubles `patience`, so a catalogue that stays too small costs a drop per doubling run of
 * fitting batches, not one per residency change. Read after that drop, a fit at a count that
 * dropped is no evidence: the drop wins. A probe that fits above the count whose drop last doubled
 * `patience` proves the catalogue grew: `patience` starts again at one, so it never piles up across
 * stretches of a catalogue that shrinks and grows back.
 */
export function createViewLimit(viewCap: number) {
  let fits = 0,
    drops = viewCap + 1,
    /** Residency changed since the last drop. */
    stale = false,
    /** Batches at the settled limit that fitted since the last drop. */
    streak = 0,
    /** The fitting batches at the limit a probe one view above it waits for. */
    patience = 1,
    /** The count whose drop last doubled `patience`. */
    failed = viewCap + 1;
  /** Residency changed and the limit sits one view below the fewest that dropped. */
  const settledStale = () => stale && fits + 1 === drops;
  return {
    read(count: number, dropped: boolean) {
      if (dropped) {
        if (settledStale() && drops <= viewCap && count >= fits) {
          patience *= 2;
          failed = count;
        }
        stale = false;
        streak = 0;
        drops = Math.min(drops, count);
        fits = Math.min(fits, drops - 1);
      } else if (count >= drops) {
        if (!stale) return;
        fits = count;
        drops = count + 1;
        if (count > failed) patience = 1;
      } else {
        fits = Math.max(fits, count);
        if (settledStale() && count >= fits) streak++;
      }
    },
    residencyChanged() {
      stale = true;
    },
    get value() {
      if (drops > viewCap) return viewCap;
      if (settledStale() && streak >= patience) return drops;
      return Math.max(1, Math.floor((fits + drops) / 2));
    },
  };
}
