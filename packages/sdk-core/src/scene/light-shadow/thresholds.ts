import { STALE_FULL, type ShadowPool } from './pool.ts';

/**
 * THE ERROR THRESHOLD EACH PAGE WAS DRAWN AT, AND THE RENDER ORIGIN IT WAS DRAWN FROM. The light
 * cuts select casters at the camera's threshold, budget included, and the budget raises it while
 * the camera moves: a page drawn then holds coarser casters than one drawn at rest. They also run
 * in the render frame, whose origin is the eye (`writeFaceSelection`): a cluster at the edge of the
 * threshold rounds to one side or the other in single precision depending on where the eye stood,
 * so a page drawn while the camera moved may hold another level of a caster than rest would draw,
 * and two runs through the same rest pose kept the shadow of their own path (#1016). When the
 * camera rests, only the pages drawn at another threshold or from another origin than the current
 * ones go stale — never every page because the threshold moved and came back: a page drawn before
 * the motion and not since is already what rest would draw. A page staled so is not wrong: it stays
 * read until redrawn.
 */
export function createShadowThresholds(pool: ShadowPool) {
  const drawnAt = new Float64Array(pool.pages).fill(NaN),
    drawnFrom = new Float64Array(pool.pages * 3);
  const origin = new Float64Array(3).fill(NaN);
  let current = NaN;
  /** `eye[at…at+2]` is the current origin; none given yet on either side counts as the same. */
  const sameOrigin = (eye: ArrayLike<number>, at: number) =>
    Object.is(eye[at], origin[0]) &&
    Object.is(eye[at + 1], origin[1]) &&
    Object.is(eye[at + 2], origin[2]);
  const thresholds = {
    /** The threshold this frame's light cuts select at, from the render origin `eye`. */
    set(threshold: number, eye: ArrayLike<number> = origin) {
      const moved = !sameOrigin(eye, 0);
      if (threshold === current && !moved) return;
      // The first threshold finds no page drawn at another.
      thresholds.pending = !Number.isNaN(current);
      current = threshold;
      origin.set([eye[0], eye[1], eye[2]]);
    },
    /** True while the threshold or the origin moved and the pages drawn at another wait for the
     *  camera to rest. */
    pending: false,
    /** Page `page` was drawn at the current threshold, from the current origin. */
    drew(page: number) {
      drawnAt[page] = current;
      drawnFrom.set(origin, page * 3);
    },
    /** The camera rests: stales the mapped pages drawn at another threshold or from another
     *  origin; returns how many. */
    restale(nowMs: number, frame: number) {
      if (!thresholds.pending) return 0;
      thresholds.pending = false;
      let staled = 0;
      for (let page = 0; page < pool.pages; page++) {
        const at = drawnAt[page],
          from = page * 3;
        if (pool.owner[page] < 0 || Number.isNaN(at)) continue;
        if (at === current && sameOrigin(drawnFrom, from)) continue;
        if (pool.stale(page, nowMs, frame, STALE_FULL)) staled++;
      }
      return staled;
    },
    reset() {
      drawnAt.fill(NaN);
      thresholds.pending = false;
    },
  };
  return thresholds as Readonly<typeof thresholds>;
}
