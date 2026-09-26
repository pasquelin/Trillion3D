import { boxEmpty, boxIsEmpty, boxUnion } from '../../math/primitives/box.ts';
import { keepNumbers } from '../../math/primitives/vector.ts';
import { VIEW_NUMBERS, writeView, type ShadowViewpoint } from '../light/contracts.ts';

/** The tested point, allocated once: `touches` is called per light and per box, every frame. */
const point = new Float64Array(3);
/** The read box, allocated once: the scheduler projects it view by view without creating anything. */
const readMin = new Float64Array(3),
  readMax = new Float64Array(3),
  readBox = { min: readMin, max: readMax, moving: false, detail: false };

/**
 * What has moved in the world since the last frame, as world boxes. Each is kept **apart**: a
 * box stales only the pages it covers in each light view (`invalidate.ts`), and a box joining two
 * movers at both ends of the scene would stale every page between them, while nothing there
 * changed (#525).
 *
 * The list is a fixed budget in pages: it holds as many boxes as the pool holds pages
 * (`capacity`), the most distinct pages a frame can draw. Past it — the one overflow — the last
 * box absorbs every further one: their union stales a superset of their pages, never fewer.
 *
 * The scheduler consumes them every frame: it derives the stale pages of each view, which
 * then carry the state. The boxes therefore have nothing to retain from one frame to the next —
 * only the held union below waits across frames —, and everything is allocated once.
 *
 * Two kinds of change enter. A **world** change — a node or a light that moves — stales its
 * pages at once. A **representation** change — a cluster that swaps level of detail, a page
 * that enters or leaves residency, a colour tile that arrives — describes the same world at
 * another precision: it is held in one union box while the camera moves, and enters the list
 * at the first frame the camera rests. Under a moving camera the cut churns every frame, and
 * staling the far pages for a sub-texel change of detail cost a whole scene draw per frame;
 * at rest the union restales exactly what changed, so a settled map is that of the current
 * cut, whatever the history (#159).
 */
export function createShadowChanges(capacity: number) {
  const min = new Float64Array(capacity * 3),
    max = new Float64Array(capacity * 3),
    /** The box holds only objects already moving: the static casters under it are unchanged. */
    moving = new Uint8Array(capacity),
    /** The box holds only the released union of representation changes: the pages under it are
     *  coarser than the cut, not wrong, and stay read until redrawn. */
    detail = new Uint8Array(capacity);
  /** The union of representation changes held until the camera rests: empty when none waits. */
  const defer = new Float64Array(6),
    deferMin = defer.subarray(0, 3),
    deferMax = defer.subarray(3, 6);
  boxEmpty(defer, 0);
  /** The view of the last frame and this frame's, to compare them. */
  const lastView = new Float64Array(VIEW_NUMBERS).fill(NaN),
    viewNow = new Float64Array(VIEW_NUMBERS);
  const write = (base: number, lo: ArrayLike<number>, hi: ArrayLike<number>, merge: boolean) => {
    for (let axis = 0; axis < 3; axis++) {
      min[base + axis] = merge ? Math.min(min[base + axis], lo[axis]) : lo[axis];
      max[base + axis] = merge ? Math.max(max[base + axis], hi[axis]) : hi[axis];
    }
  };
  /** Box `count` takes the change; past the budget the last box absorbs it (the overflow). */
  const add = (
    lo: ArrayLike<number>,
    hi: ArrayLike<number>,
    movingOnly: boolean,
    detailOnly: boolean,
  ) => {
    const merge = changes.count === capacity,
      box = merge ? capacity - 1 : changes.count++;
    write(box * 3, lo, hi, merge);
    moving[box] = movingOnly && (!merge || moving[box]) ? 1 : 0;
    detail[box] = detailOnly && (!merge || detail[box]) ? 1 : 0;
  };
  const worldChanged = (lo: ArrayLike<number>, hi: ArrayLike<number>, movingOnly = false) =>
    add(lo, hi, movingOnly, false);
  /** The held union enters the list as one box, when one waits. */
  const release = () => {
    if (boxIsEmpty(defer, 0)) return;
    add(deferMin, deferMax, false, true);
    boxEmpty(defer, 0);
  };
  const changes = {
    /** Boxes in the list. */
    count: 0,
    /** A representation change waits for the camera to rest: the hold must not close before. */
    deferred: () => !boxIsEmpty(defer, 0),
    /**
     * A node has moved: its box enters the list, or the overflow box past the budget. `movingOnly`
     * says it holds objects that were already moving — the static casters under it did not change.
     */
    worldChanged,
    /** The same world at another precision: its box joins the union held until the camera rests. */
    representationChanged(lo: ArrayLike<number>, hi: ArrayLike<number>) {
      boxUnion(defer, 0, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    },
    /**
     * The frame's view. When it is the one of the previous frame the camera rests, and what
     * changed representation meanwhile enters the list as one box; while it moves, the union
     * only grows. Returns true when the camera rests.
     */
    observeView(view: ShadowViewpoint) {
      const still = keepNumbers(lastView, writeView(view, viewNow));
      if (still) release();
      return still;
    },
    /**
     * Influence sphere of a light against box `box`: an analytic test, not a ray. A
     * light without range — the sun — sees everything that moves, and therefore always returns true.
     */
    touches(box: number, x: number, y: number, z: number, range: number) {
      const base = box * 3;
      if (!(range > 0)) return true;
      let squared = 0;
      point[0] = x;
      point[1] = y;
      point[2] = z;
      for (let axis = 0; axis < 3; axis++) {
        const gap = Math.max(min[base + axis] - point[axis], point[axis] - max[base + axis], 0);
        squared += gap * gap;
      }
      return squared <= range * range;
    },
    /** Box `box` in two reused arrays — its minima, its maxima —, whether it moves alone, and
     *  whether it is a change of detail alone. */
    read(box: number) {
      const base = box * 3;
      readBox.moving = moving[box] === 1;
      readBox.detail = detail[box] === 1;
      for (let axis = 0; axis < 3; axis++) {
        readMin[axis] = min[base + axis];
        readMax[axis] = max[base + axis];
      }
      return readBox;
    },
    /** The boxes are consumed: the pages they stale now carry the state. */
    settled() {
      changes.count = 0;
    },
    /**
     * No plan consumes the union this frame — no atlas, no light, unlit view — while the slices
     * survive: it enters the list now, and the next plan, at rest or not, stales what changed.
     */
    releaseDeferred: release,
    /** Nothing waits anymore, and the next view is a first one. */
    reset() {
      changes.count = 0;
      boxEmpty(defer, 0);
      lastView.fill(NaN);
    },
  };
  return changes as Readonly<typeof changes>;
}
