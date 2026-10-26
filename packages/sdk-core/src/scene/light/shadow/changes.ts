import {
  boxEmpty,
  boxesOverlap,
  boxIsEmpty,
  boxUnion,
} from '../../../../../math/src/geometry/box.ts'
import { boxPointDistance } from '../../../../../math/src/geometry/boxDistance.ts'
import { keepNumbers } from '../../../../../math/src/vector/vector.ts'
import { VIEW_NUMBERS, writeView, type ShadowViewpoint } from '../contracts.ts'

/** A residency change's box in the six-value layout, allocated once. */
const incoming = new Float64Array(6)

/** The read box, allocated once: the scheduler projects it view by view without creating anything. */
const readMin = new Float64Array(3),
  readMax = new Float64Array(3),
  readBox = { min: readMin, max: readMax, moving: false, detail: false }

/**
 * What has moved in the world since the last frame, as world boxes. Each is kept **apart**: a
 * box stales only the pages it covers in each light view, and a box joining two
 * movers at both ends of the scene would stale every page between them, while nothing there
 * changed.
 *
 * The list is a fixed budget (`capacity`): as many boxes as the pool holds pages, the most
 * distinct pages a frame can draw, and at least `SHADOW_CHANGE_BOXES`. Past it — the one overflow
 * — the last box absorbs every further one: their union stales a superset of their pages, never
 * fewer. The placements' moves, arrivals and departures enter it from the GPU, the boxes they
 * had and the boxes they have (`sdk-browser/src/lighting/shadows/casters/castDiffWgsl.ts`).
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
 * cut, whatever the history. A representation change of objects already moving is held
 * in a union of its own, released as a moving box: the static layer never held them.
 *
 * A **residency** change is the one representation change that enters at once: a page drawn
 * before a finer form of its caster arrived holds a caster that no longer matches the receiver the
 * camera now draws, a coarse surface standing above the fine one, read as dark patches cut straight
 * along page edges while a drive lasts. The cached pages stay read until redrawn, within the
 * budget.
 */
/** Boxes the list holds apart at least: each is projected in every light view it may reach at the
 *  next plan, so the count bounds that work. Declared: a few hundred residency changes a frame, and
 *  room to spare. */
export const SHADOW_CHANGE_BOXES = 4096

/** What the list holds, shared by the functions below and the object `createShadowChanges` returns. */
interface ChangeStore {
  readonly capacity: number
  /** Boxes in the list. */
  count: number
  /** The boxes, six values each — minima then maxima —, the layout of the box helpers. */
  readonly boxes: Float64Array
  /** The box holds only objects already moving: the static casters under it are unchanged. */
  readonly moving: Uint8Array
  /** The box holds only the released union of representation changes: the pages under it are
   *  coarser than the cut, not wrong, and stay read until redrawn. */
  readonly detail: Uint8Array
  /** The unions of representation changes held until the camera rests — whatever it touches,
   *  then objects already moving alone —: empty when none waits. */
  readonly held: { box: Float64Array; min: Float64Array; max: Float64Array; movingOnly: boolean }[]
  /** The view of the last frame, to compare with this frame's. */
  readonly lastView: Float64Array
  /** This frame's view in float32, the precision a move must cross to count (`observeView`). */
  readonly viewNow: Float32Array
}

function createChangeStore(capacity: number): ChangeStore {
  return {
    capacity,
    count: 0,
    boxes: new Float64Array(capacity * 6),
    moving: new Uint8Array(capacity),
    detail: new Uint8Array(capacity),
    held: [false, true].map((movingOnly) => {
      const box = new Float64Array(6)
      boxEmpty(box, 0)
      return { box, min: box.subarray(0, 3), max: box.subarray(3, 6), movingOnly }
    }),
    lastView: new Float64Array(VIEW_NUMBERS).fill(NaN),
    viewNow: new Float32Array(VIEW_NUMBERS),
  }
}

/** Box `box` set to `lo…hi`, or grown by it (`boxUnion`). */
function writeBox(
  store: ChangeStore,
  box: number,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  merge: boolean,
) {
  if (!merge) boxEmpty(store.boxes, box * 6)
  boxUnion(store.boxes, box * 6, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2])
}

/** Box `count` takes the change; past the budget the last box absorbs it (the overflow). */
function addBox(
  store: ChangeStore,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  movingOnly: boolean,
  detailOnly: boolean,
) {
  const merge = store.count === store.capacity,
    box = merge ? store.capacity - 1 : store.count++
  writeBox(store, box, lo, hi, merge)
  store.moving[box] = movingOnly && (!merge || store.moving[box]) ? 1 : 0
  store.detail[box] = detailOnly && (!merge || store.detail[box]) ? 1 : 0
}

/** Each held union enters the list as one box, when one waits. */
function releaseHeld(store: ChangeStore) {
  for (const { box, min: lo, max: hi, movingOnly } of store.held) {
    if (boxIsEmpty(box, 0)) continue
    addBox(store, lo, hi, movingOnly, true)
    boxEmpty(box, 0)
  }
}

/** A caster's residency changed: its box enters the list at once, stale for detail alone,
 *  merged into the last one when that is a change of detail of the same kind it overlaps — the
 *  clusters a stream brings in together —, never joined to a far one. */
function addResidency(
  store: ChangeStore,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  movingOnly: boolean,
) {
  const last = store.count - 1
  for (let axis = 0; axis < 3; axis++) {
    incoming[axis] = lo[axis]
    incoming[axis + 3] = hi[axis]
  }
  const overlaps =
    last >= 0 &&
    store.detail[last] === 1 &&
    store.moving[last] === +movingOnly &&
    boxesOverlap(store.boxes, last * 6, incoming, 0)
  if (overlaps) writeBox(store, last, lo, hi, true)
  else addBox(store, lo, hi, movingOnly, true)
}

/** Box `box` in two reused arrays — its minima, its maxima —, whether it moves alone, and
 *  whether it is a change of detail alone. */
function readBoxOf(store: ChangeStore, box: number) {
  const base = box * 6
  readBox.moving = store.moving[box] === 1
  readBox.detail = store.detail[box] === 1
  for (let axis = 0; axis < 3; axis++) {
    readMin[axis] = store.boxes[base + axis]
    readMax[axis] = store.boxes[base + 3 + axis]
  }
  return readBox
}

/**
 * The frame's view. When it is the one of the previous frame the camera rests, and what
 * changed representation meanwhile enters the list as one box; while it moves, the union
 * only grows. Returns true when the camera rests: its numbers are weighed in float32, so a view
 * that moved by less than a float32 step of them — a chase camera easing toward a car at rest,
 * by 1e-11 m a frame — rests. Such a move is far below any page's texel (`pixelNear`): it asks
 * nothing new, and the camera that crawls past a float32 step moves again.
 */
function observeChangeView(store: ChangeStore, view: ShadowViewpoint) {
  const still = keepNumbers(store.lastView, writeView(view, store.viewNow))
  if (still) releaseHeld(store)
  return still
}

/**
 * Influence sphere of a light against box `box`: an analytic test, not a ray. A
 * light without range — the sun — sees everything that moves, and therefore always returns true;
 * so does a box that bounds nothing finite (`NaN`): nothing proves it out of reach.
 */
function touchesBox(
  store: ChangeStore,
  box: number,
  x: number,
  y: number,
  z: number,
  range: number,
) {
  if (!(range > 0)) return true
  return !(boxPointDistance(store.boxes, box * 6, x, y, z) > range)
}

export function createShadowChanges(capacity: number) {
  const store = createChangeStore(capacity)
  const { held } = store
  const worldChanged = (lo: ArrayLike<number>, hi: ArrayLike<number>, movingOnly = false) =>
    addBox(store, lo, hi, movingOnly, false)
  const changes = {
    /** Boxes in the list. */
    count: () => store.count,
    /** A representation change waits for the camera to rest: the hold must not close before. */
    deferred: () => !boxIsEmpty(held[0].box, 0) || !boxIsEmpty(held[1].box, 0),
    /**
     * A node has moved: its box enters the list, or the overflow box past the budget. `movingOnly`
     * says it holds objects that were already moving — the static casters under it did not change.
     */
    worldChanged,
    /** The same world at another precision: its box joins the union held until the camera rests;
     *  `movingOnly`, the one of objects already moving, whose static casters did not change. */
    representationChanged(lo: ArrayLike<number>, hi: ArrayLike<number>, movingOnly = false) {
      boxUnion(held[+movingOnly].box, 0, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2])
    },
    residencyChanged: (lo: ArrayLike<number>, hi: ArrayLike<number>, movingOnly = false) =>
      addResidency(store, lo, hi, movingOnly),
    observeView: (view: ShadowViewpoint) => observeChangeView(store, view),
    touches: (box: number, x: number, y: number, z: number, range: number) =>
      touchesBox(store, box, x, y, z, range),
    read: (box: number) => readBoxOf(store, box),
    /** True when a box of the list is a world change: something moved this frame. */
    worldMoved() {
      for (let box = 0; box < store.count; box++) if (!store.detail[box]) return true
      return false
    },
    /** The boxes are consumed: the pages they stale now carry the state. */
    settled() {
      store.count = 0
    },
    /**
     * No plan consumes the union this frame — no atlas, no light, unlit view — while the slices
     * survive: it enters the list now, and the next plan, at rest or not, stales what changed.
     */
    releaseDeferred: () => releaseHeld(store),
    /** Nothing waits anymore, and the next view is a first one. */
    reset() {
      store.count = 0
      for (const { box } of held) boxEmpty(box, 0)
      store.lastView.fill(NaN)
    },
  }
  return changes as Readonly<typeof changes>
}
