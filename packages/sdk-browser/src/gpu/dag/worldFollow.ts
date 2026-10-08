/**
 * THE PLACEMENTS' LINKS TO THE WORLD DAG KEPT TO WHAT THEY PLACE.
 *
 * A placement row that takes an object of the world DAG — a cell placed — or gives it back — a cell
 * left — tells the selection which (`placeObject`): the links that moved go up behind the cold
 * records before the next cut, the moved ranks joined into writes by the cut's one run writer,
 * by their bytes (`split.ts`) — what is written follows the moves (`worldLinks.ts`) —, read
 * by the descent's gate, and the residency mirror reads the move at the next residency it hands
 * the cut (`worldMirror.ts`). A move with no residency change behind it is handed
 * over before the next cut is encoded, on the rows' flags the cut last received: the object's
 * cluster turns out the frame its placement leaves, so its group's super-roots stand in at once.
 * Each cut takes its own scale of the world's threshold (`worldFade.ts`).
 */
import type { GpuSelection, ResidencyChanges, SelectionUniforms } from '../core/selection.ts'
import { SELECTION_NONE as NONE } from '../core/selection.ts'
import { worldFadeScale } from './worldFade.ts'
import type { PackedDag } from './types.ts'
import { writeRanges, type DagParts } from './split.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { keepNumbers } from '../../../../math/src/vector/vector.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'

/** No page of the rows moved: only the links did. */
const NO_ROWS: ResidencyChanges = { pages: new Int32Array(0), count: 0 }

/** `selection`, its placements' links to the world DAG followed on `coldParts`; as it is without
 *  a world DAG. */
export function followWorldLinks(
  selection: GpuSelection,
  resources: { device: GPUDevice; packed: PackedDag; coldParts: DagParts },
) {
  const { device, packed, coldParts } = resources,
    world = packed.world
  if (!world) return selection
  const { links } = world
  /** The rows' flags the cut last received, and whether a link moved since. */
  let rows: Uint32Array | undefined,
    pending = false
  /** The placements whose link moved since the last cut, one bit each, from `low` to `high`. */
  const dirty = new Uint32Array(bitWords(links.length))
  let low = links.length,
    high = -1
  /** The moved ranks, increasing, read off the bitmap; the write ranges over them. `listed`: the
   *  ranks the list holds, -1 once a link moved since it was read. */
  let moved = new Int32Array(8),
    listed = -1,
    /** The list was handed to the mirror since the last move: the cut's upload hands it no more. */
    handed = false
  const { updateResidency, dispatch } = selection
  /** The ranks whose link moved since the last cut, increasing, read off the bitmap into `moved`
   *  once for every move since — the one record of the moves, which the upload writes and the
   *  mirror reads —; their count. */
  const listMoved = () => {
    if (listed >= 0) return listed
    let count = 0
    if (high >= 0)
      for (let word = low >>> 5; word <= high >>> 5; word++)
        for (let bits = dirty[word]; bits; bits &= bits - 1) {
          if (count === moved.length) moved = resized(moved, count + 1)
          moved[count++] = (word << 5) + 31 - Math.clz32(bits & -bits)
        }
    return (listed = count)
  }
  selection.updateResidency = (next, changes, pages) => {
    rows = next
    pending = false
    if (!handed) {
      // Listed first: a list that grows is another array, the one the mirror must read.
      const count = listMoved()
      world.linksMoved?.(moved, count)
      handed = true
    }
    return updateResidency(next, changes, pages)
  }
  selection.worldStandsIn = (w) => w < links.length && links[w] !== NONE
  selection.placeObject = (w, object) => {
    const c = world.linkOf(object)
    if (w === world.root || links[w] === c) return
    links[w] = c
    selection.linkMoved?.(w)
    dirty[w >>> 5] |= 1 << (w & 31)
    listed = -1
    handed = false
    low = Math.min(low, w)
    high = Math.max(high, w)
    pending = true
  }
  const linkWords = { data: links, sourceBase: 0, targetBase: world.linkBase, stride: 1 }
  /** The links that moved since the last cut, taken up in the ranges their ranks coalesce into,
   *  the empty words of the bitmap skipped whole. */
  const takeUp = () => {
    if (high < 0) return
    const count = listMoved()
    writeRanges(device, coldParts, moved, count, linkWords)
    if (!handed) world.linksMoved?.(moved, count)
    dirty.fill(0, low >>> 5, (high >>> 5) + 1)
    low = links.length
    high = -1
    // Taken up, the list is empty: nothing left to hand.
    listed = 0
    handed = true
  }
  /** The camera of the last cut — its view and its eye —, and the moves seen since the first. */
  const held = {
    view: new Float64Array(16).fill(NaN),
    eye: new Float64Array(3).fill(NaN),
  }
  let moves = 0
  selection.dispatch = (uniforms, shared) => {
    takeUp()
    if (pending && rows) selection.updateResidency(rows, NO_ROWS)
    // A camera that moved takes the next scale of the world's threshold, its transitions dithered
    // in time; a still one keeps its own, whatever arrives meanwhile: no hand-over flickers.
    if (cameraMoved(held, uniforms)) moves++
    world.scale = worldFadeScale(moves)
    return dispatch(uniforms, shared)
  }
  return selection
}

/** Whether `uniforms`' camera — its view, its eye — is not the one `held`, which takes it. */
function cameraMoved(held: { view: Float64Array; eye: Float64Array }, uniforms: SelectionUniforms) {
  const view = keepNumbers(held.view, uniforms.view)
  return !(keepNumbers(held.eye, uniforms.cameraWorld) && view)
}
