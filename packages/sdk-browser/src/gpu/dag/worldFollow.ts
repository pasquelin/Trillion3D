/**
 * THE PLACEMENTS' LINKS TO THE WORLD DAG KEPT TO WHAT THEY PLACE.
 *
 * A placement row that takes an object of the world DAG — a cell placed — or gives it back — a cell
 * left — tells the selection which (`placeObject`): the links that moved go up behind the cold
 * records before the next cut, the moved ranks joined into writes by the one rule the residency
 * flush writes by (`RESIDENCY_RULE`) — what is written follows the moves (`worldLinks.ts`) —, read
 * by the descent's gate, and the residency mirror reads the move at the next residency it hands
 * the cut (`worldMirror.ts`). A move with no residency change behind it is handed
 * over before the next cut is encoded, on the rows' flags the cut last received: the object's
 * cluster turns out the frame its placement leaves, so its group's super-roots stand in at once.
 * Each cut takes its own scale of the world's threshold (`worldFade.ts`).
 */
import type { GpuSelection, ResidencyChanges, SelectionUniforms } from '../core/selection.ts'
import { SELECTION_NONE as NONE } from '../core/selection.ts'
import { objectClusters } from './worldLinks.ts'
import { worldFadeScale } from './worldFade.ts'
import type { PackedDag } from './types.ts'
import { writeRanges, type DagParts } from './split.ts'
import { RESIDENCY_RULE } from '../../webgpu/residency/ranges.ts'
import { grown } from '../../page/cut/sparseInts.ts'

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
  const clusterOf = objectClusters(world.origins),
    base = packed.cutLinks[world.root].pageBase,
    { links } = world
  /** The rows' flags the cut last received, and whether a link moved since. */
  let rows: Uint32Array | undefined,
    pending = false
  /** The placements whose link moved since the last cut, one bit each, from `low` to `high`. */
  const dirty = new Uint32Array((links.length + 31) >>> 5)
  let low = links.length,
    high = -1
  /** The moved ranks, increasing, read off the bitmap; the write ranges over them. */
  let moved = new Int32Array(8)
  const ranges = new Int32Array(RESIDENCY_RULE.cap * 2)
  const { updateResidency, dispatch } = selection
  selection.updateResidency = (next, changes, moved) => {
    rows = next
    pending = false
    return updateResidency(next, changes, moved)
  }
  selection.worldStandsIn = (w) => w < links.length && links[w] !== NONE
  selection.placeObject = (w, object) => {
    const rank = object >= 0 ? (clusterOf[object] ?? -1) : -1,
      c = rank >= 0 ? base + rank : NONE
    if (w === world.root || links[w] === c) return
    links[w] = c
    world.moved.add(w)
    dirty[w >>> 5] |= 1 << (w & 31)
    low = Math.min(low, w)
    high = Math.max(high, w)
    pending = true
  }
  const linkWords = { data: links, sourceBase: 0, targetBase: world.linkBase, stride: 1 }
  /** The links that moved since the last cut, taken up in the ranges their ranks coalesce into,
   *  the empty words of the bitmap skipped whole. */
  const takeUp = () => {
    if (high < 0) return
    let count = 0
    for (let word = low >>> 5; word <= high >>> 5; word++)
      for (let bits = dirty[word]; bits; bits &= bits - 1) {
        if (count === moved.length) moved = grown(moved, count + 1, count)
        moved[count++] = (word << 5) + 31 - Math.clz32(bits & -bits)
      }
    writeRanges(device, coldParts, moved, count, linkWords, ranges)
    dirty.fill(0, low >>> 5, (high >>> 5) + 1)
    low = links.length
    high = -1
  }
  /** The camera of the last cut — its view and its eye —, and the moves seen since the first. */
  const held = new Float64Array(19).fill(NaN)
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
function cameraMoved(held: Float64Array, { view, cameraWorld }: SelectionUniforms) {
  let moved = false
  for (let k = 0; k < 16; k++) moved = moved || held[k] !== view[k]
  for (let a = 0; a < 3; a++) moved = moved || held[16 + a] !== cameraWorld[a]
  held.set(view)
  held.set(cameraWorld, 16)
  return moved
}
