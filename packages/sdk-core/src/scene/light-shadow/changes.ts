import { keepNumbers } from '../../math/primitives/vector.ts';
import { VIEW_NUMBERS, writeView, type ShadowViewpoint } from '../light/contracts.ts';

/** Motion boxes kept separate before merge: beyond that, two boxes join. */
const MOVED_BOXES = 8;

/** The tested point, allocated once: `touches` is called per light and per box, every frame. */
const point = new Float64Array(3);
/** The read box, allocated once: the scheduler projects it face by face without creating anything. */
const readMin = new Float64Array(3),
  readMax = new Float64Array(3),
  readBox = { min: readMin, max: readMax, moving: false, detail: false };
/** A held box on its way to the list, allocated once. */
const heldMin = new Float64Array(3),
  heldMax = new Float64Array(3);

/**
 * Up to `MOVED_BOXES` world boxes kept apart, each saying whether it holds only objects already
 * moving and whether it is only a change of detail. Past that, a new box joins the one whose
 * union with it costs the least volume. Allocated once.
 */
function createBoxList() {
  const min = new Float64Array(MOVED_BOXES * 3),
    max = new Float64Array(MOVED_BOXES * 3),
    /** The box holds only objects already moving: the static casters under it are unchanged. */
    moving = new Uint8Array(MOVED_BOXES),
    /** The box holds only representation changes: the pages under it are coarser than the cut,
     *  not wrong, and stay read until redrawn. */
    detail = new Uint8Array(MOVED_BOXES);
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
  const list = {
    min,
    max,
    moving,
    detail,
    count: 0,
    add(lo: ArrayLike<number>, hi: ArrayLike<number>, movingOnly: boolean, detailOnly: boolean) {
      if (list.count < MOVED_BOXES) {
        write(list.count * 3, lo, hi, false);
        moving[list.count] = movingOnly ? 1 : 0;
        detail[list.count] = detailOnly ? 1 : 0;
        list.count++;
        return;
      }
      let best = 0,
        bestGrowth = Infinity;
      for (let box = 0; box < list.count; box++) {
        const growth = volume(box * 3, lo, hi) - own(box * 3);
        if (growth < bestGrowth) {
          bestGrowth = growth;
          best = box;
        }
      }
      write(best * 3, lo, hi, true);
      if (!movingOnly) moving[best] = 0;
      if (!detailOnly) detail[best] = 0;
    },
  };
  return list;
}

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
 * another precision: it is held while the camera moves, and enters the list at the first frame
 * the camera rests. Under a moving camera the cut churns every frame, and staling the far pages
 * for a sub-texel change of detail cost a whole scene draw per frame; at rest the held boxes
 * restale exactly what changed, so a settled map is that of the current cut, whatever the
 * history (#159). The held boxes stay apart as the world ones do: two clusters that changed at
 * both ends of the view redraw their own pages, never those between them.
 */
export function createShadowChanges() {
  const boxes = createBoxList(),
    { min, max, moving, detail } = boxes,
    /** The representation changes held until the camera rests. */
    held = createBoxList();
  /** The view of the last frame, and this frame's the time to compare them. */
  const lastView = new Float64Array(VIEW_NUMBERS).fill(NaN),
    viewNow = new Float64Array(VIEW_NUMBERS);
  const worldChanged = (lo: ArrayLike<number>, hi: ArrayLike<number>, movingOnly = false) =>
    boxes.add(lo, hi, movingOnly, false);
  /** The held boxes enter the list, each a change of detail alone. */
  const release = () => {
    for (let box = 0; box < held.count; box++) {
      for (let axis = 0; axis < 3; axis++) {
        heldMin[axis] = held.min[box * 3 + axis];
        heldMax[axis] = held.max[box * 3 + axis];
      }
      boxes.add(heldMin, heldMax, false, true);
    }
    held.count = 0;
  };
  return {
    get count() {
      return boxes.count;
    },
    /** A representation change waits for the camera to rest: the hold must not close before. */
    get deferred() {
      return held.count > 0;
    },
    /**
     * A node has moved: its box enters the list, or joins a neighbour. `movingOnly` says it holds
     * objects that were already moving — the static casters under it did not change.
     */
    worldChanged,
    /** The same world at another precision: its box is held, apart or joined to the nearest
     *  held one, until the camera rests. */
    representationChanged(lo: ArrayLike<number>, hi: ArrayLike<number>) {
      held.add(lo, hi, false, true);
    },
    /**
     * The frame's view. When it is the one of the previous frame the camera rests, and what
     * changed representation meanwhile enters the list; while it moves, the held boxes only
     * grow. Returns true when the camera rests.
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
      boxes.count = 0;
    },
    /**
     * No plan consumes the held boxes this frame — no atlas, no light, unlit view — while the slices
     * survive: it enters the list now, and the next plan, at rest or not, stales what changed.
     */
    releaseDeferred: release,
    /** Nothing waits anymore, and the next view is a first one. */
    reset() {
      boxes.count = held.count = 0;
      lastView.fill(NaN);
    },
  };
}
