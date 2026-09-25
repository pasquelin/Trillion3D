/**
 * The light views one batch draws in, bisected between the most views a batch drew whole and the
 * fewest a batch dropped work with: a drop at `L` views never swings the limit between `L` and
 * `L / 2`, it settles on the largest count that fits, never below one. What dropped depends on the
 * clusters the views kept from the resident catalogue: a residency change forgets the drop, never
 * what fitted — once the camera rests (`lightCutRedraws.ts`).
 */
export function createViewLimit(viewCap: number) {
  let fits = 0,
    drops = viewCap + 1;
  return {
    read(count: number, dropped: boolean) {
      if (dropped) {
        drops = Math.min(drops, count);
        fits = Math.min(fits, drops - 1);
      } else {
        fits = Math.max(fits, count);
        if (fits >= drops) drops = viewCap + 1;
      }
    },
    residencyChanged() {
      drops = viewCap + 1;
    },
    get value() {
      return drops > viewCap ? viewCap : Math.max(1, Math.floor((fits + drops) / 2));
    },
  };
}
