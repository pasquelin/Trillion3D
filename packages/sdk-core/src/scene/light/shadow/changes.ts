import { boxEmpty, boxUnion } from '../../../../../math/src/geometry/box.ts'

/** The read box, allocated once: `vsmCastBoxes` writes it as a record without creating anything. */
const readMin = new Float64Array(3),
  readMax = new Float64Array(3),
  readBox = { min: readMin, max: readMax, moving: false }

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
 * The plan consumes them every frame: `vsmCastBoxes` writes one record a box, for every view, the
 * stale kernel's range test and map cull deciding which pages each stales, and `settled` empties
 * the list. The boxes therefore have nothing to retain from one frame to the next, and everything
 * is allocated once.
 *
 * Every change is a **world** change — a node or a light that moves, a surface whose alpha moved,
 * a cell that switched between its placements and its HLOD actor: it stales its pages at once.
 * Streaming is none: a cluster that enters or leaves residency, or a colour tile that arrives,
 * declares no box here. The pages over a cluster drawn coarser than the view asks are the cull's
 * own to invalidate, behind `shadowInvalidateOnLodDelta`.
 */
/** Boxes the list holds apart at least: each is one record the stale kernel tests against every
 *  map at the next plan, so the count bounds that work. Declared: a few hundred changes a frame, and room to
 *  spare. */
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
}

function createChangeStore(capacity: number): ChangeStore {
  return {
    capacity,
    count: 0,
    boxes: new Float64Array(capacity * 6),
    moving: new Uint8Array(capacity),
  }
}

/** Box `count` takes the change; past the budget the last box absorbs it (the overflow). */
function addBox(
  store: ChangeStore,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  movingOnly: boolean,
) {
  const merge = store.count === store.capacity,
    box = merge ? store.capacity - 1 : store.count++
  if (!merge) boxEmpty(store.boxes, box * 6)
  boxUnion(store.boxes, box * 6, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2])
  store.moving[box] = movingOnly && (!merge || store.moving[box]) ? 1 : 0
}

/** Box `box` in two reused arrays — its minima, its maxima — and whether it moves alone. */
function readBoxOf(store: ChangeStore, box: number) {
  const base = box * 6
  readBox.moving = store.moving[box] === 1
  for (let axis = 0; axis < 3; axis++) {
    readMin[axis] = store.boxes[base + axis]
    readMax[axis] = store.boxes[base + 3 + axis]
  }
  return readBox
}

export function createShadowChanges(capacity: number) {
  const store = createChangeStore(capacity)
  const changes = {
    /** Boxes in the list. */
    count: () => store.count,
    /**
     * A node has moved: its box enters the list, or the overflow box past the budget. `movingOnly`
     * says it holds objects that were already moving — the static casters under it did not change.
     */
    worldChanged: (lo: ArrayLike<number>, hi: ArrayLike<number>, movingOnly = false) =>
      addBox(store, lo, hi, movingOnly),
    read: (box: number) => readBoxOf(store, box),
    /** The boxes are consumed: the pages they stale now carry the state. */
    settled() {
      store.count = 0
    },
  }
  return changes as Readonly<typeof changes>
}
