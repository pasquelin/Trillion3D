import { boxEmpty, boxUnion } from './mathBox.ts';
import { keepNumbers } from './mathVector.ts';
import { VIEW_NUMBERS, writeView, type ShadowViewpoint } from './sceneLightContracts.ts';

/** Motion boxes kept separate before merge: beyond that, two boxes join. */
const MOVED_BOXES = 8;

/** The tested point, allocated once: `touches` is called per light and per box, every frame. */
const point = new Float64Array(3);
/** The read box, allocated once: the scheduler projects it face by face without creating anything. */
const readMin = new Float64Array(3),
  readMax = new Float64Array(3),
  readBox = { min: readMin, max: readMax };

/**
 * What has moved in the world since the last frame, as world boxes. They are kept
 * **separate** — up to eight — and not joined into one: a single box enclosing two objects
 * at both ends of the scene would stale every page between them, while nothing there has changed.
 * Beyond eight, two boxes merge, those whose union costs the least volume.
 *
 * The scheduler consumes them every frame: it derives the stale pages of each face, which
 * then carry the state. The boxes therefore have nothing to retain from one frame to the next, and
 * everything is allocated once.
 *
 * Two kinds of change enter. A **world** change — a node or a light that moves — stales its
 * pages at once. A **representation** change — a cluster that swaps level of detail, a page
 * that enters or leaves residency, a colour tile that arrives — describes the same world at
 * another precision: it is held in one union box while the camera moves, and enters the list
 * at the first frame the camera rests. Under a moving camera the cut churns every frame, and
 * staling the far cascades for a sub-texel change of detail cost a whole scene draw per frame;
 * at rest the union restales exactly what changed, so a settled map is that of the current
 * cut, whatever the history (#159).
 */
export function createShadowChanges() {
  const min = new Float64Array(MOVED_BOXES * 3),
    max = new Float64Array(MOVED_BOXES * 3);
  let count = 0;
  /** The union of representation changes held until the camera rests: empty when none waits. */
  const defer = new Float64Array(6),
    deferMin = defer.subarray(0, 3),
    deferMax = defer.subarray(3, 6);
  boxEmpty(defer, 0);
  /** The view of the last frame, and this frame's the time to compare them. */
  const lastView = new Float64Array(VIEW_NUMBERS).fill(NaN),
    viewNow = new Float64Array(VIEW_NUMBERS);
  const volume = (base: number, lo: ArrayLike<number>, hi: ArrayLike<number>) => {
    let product = 1;
    for (let axis = 0; axis < 3; axis++)
      product *= Math.max(max[base + axis], hi[axis]) - Math.min(min[base + axis], lo[axis]);
    return product;
  };
  const own = (base: number) =>
    (max[base] - min[base]) * (max[base + 1] - min[base + 1]) * (max[base + 2] - min[base + 2]);
  const write = (base: number, lo: ArrayLike<number>, hi: ArrayLike<number>, merge: boolean) => {
    for (let axis = 0; axis < 3; axis++) {
      min[base + axis] = merge ? Math.min(min[base + axis], lo[axis]) : lo[axis];
      max[base + axis] = merge ? Math.max(max[base + axis], hi[axis]) : hi[axis];
    }
  };
  const worldChanged = (lo: ArrayLike<number>, hi: ArrayLike<number>) => {
    if (count < MOVED_BOXES) {
      write(count * 3, lo, hi, false);
      count++;
      return;
    }
    let best = 0,
      bestGrowth = Infinity;
    for (let box = 0; box < count; box++) {
      const growth = volume(box * 3, lo, hi) - own(box * 3);
      if (growth < bestGrowth) {
        bestGrowth = growth;
        best = box;
      }
    }
    write(best * 3, lo, hi, true);
  };
  /** The held union enters the list as one box, when one waits. */
  const release = () => {
    if (defer[0] === Infinity) return;
    worldChanged(deferMin, deferMax);
    boxEmpty(defer, 0);
  };
  return {
    get count() {
      return count;
    },
    /** A representation change waits for the camera to rest: the hold must not close before. */
    get deferred() {
      return defer[0] !== Infinity;
    },
    /** A node has moved: its box enters the list, or joins a neighbour. */
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
    /** Box `box` in two reused arrays: `[0]` its minima, `[1]` its maxima. */
    read(box: number) {
      const base = box * 3;
      for (let axis = 0; axis < 3; axis++) {
        readMin[axis] = min[base + axis];
        readMax[axis] = max[base + axis];
      }
      return readBox;
    },
    /** The boxes are consumed: the pages they stale now carry the state. */
    settled() {
      count = 0;
    },
    /**
     * No plan consumes the union this frame — no atlas, no light, unlit view — while the slices
     * survive: it enters the list now, and the next plan, at rest or not, stales what changed.
     */
    releaseDeferred: release,
    /** Nothing waits anymore, and the next view is a first one. */
    reset() {
      count = 0;
      boxEmpty(defer, 0);
      lastView.fill(NaN);
    },
  };
}
