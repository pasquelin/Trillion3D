import { followBlendScene } from '../../blend/resources.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { holdOffsetReach } from '../../deformation/halfFloat.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'
import {
  OBJECT_VIEW_BITS,
  objectBits,
  objectOffsetRow,
  switchesOfObject,
} from '../../geometry/rows/page/offsetRow.ts'
import { rowCell } from '../../geometry/partition/rowCells.ts'
import type { GraphRasters } from '../../materials/graph/graphRasters.ts'
import { wpoProgramOf } from '../../materials/graph/wpoProgram.ts'
import { rootSource } from '../../placement/hidden.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import {
  holdsOffsetSwitches,
  offsetSwitchEdits,
} from '../../../../sdk-core/src/world/object/offsetSwitches.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { MOBILITY_SHADOWLESS } from '../../lighting/shadows/mobilityBits.ts'
import { markRootEntries } from './movedRoot.ts'
import { noteDeformed } from './movedGeometry.ts'

/**
 * WHAT A ROOT'S OFFSETS ASK OF THE CUTS AND THE SHADOWS: the vertices of a surface that wires a
 * `worldPositionOffset` lie where the offset puts them, not where the page bounds them. The most a
 * surface says its offset moves a vertex along an axis (`maxWorldPositionOffset`, in metres; 0 says
 * nothing and grows nothing), the greatest over the root's surfaces, is the root's reach, in its own
 * units, added to its deformation's (`holdOffsetReach`): every cut — the CPU's, the GPU's by the root's
 * mark — grows the bounds of its pages by it (`markRootEntries`).
 *
 * Read once for each change, never each image: which roots wear an offset the session holds
 * (`GraphRasters.offsets`) is decided by their pages' surfaces — read once for the list of pages the
 * placements of a primitive share, again when a surface's offset facts moved (`MaterialTable.offsetEpoch`),
 * the roots changed, or a switch of a node was written anywhere (`offsetSwitchEdits`). An image then
 * walks the roots that wear an offset alone: reads their object's switches (`objectOffsetRow`), held
 * in `RootOffsets` for the rows (`PageInfo.wpo` and the words beside it) and, for the shadow raster,
 * in the placements' mobility words (`MOBILITY_OFFSET_SILENT`, `MOBILITY_OFFSET_KEEPS_CACHE`) and
 * their distances: the raster's cull decides, per map and per cluster, which pages an evaluated
 * offset invalidates (`vsmRenderCullViews`). Only the object that asks `always` is declared to the
 * shadow scheduler (`noteDeformed`) every image, whatever it wears.
 */
interface RootFacts {
  /** The greatest `maxWorldPositionOffset` of the root's surfaces that wear an offset, metres. */
  readonly most: number
  /** Whether one of them evaluates the offset whatever its object and the distance say. */
  readonly always: boolean
}

/** What the surfaces of `pages` ask: none for pages whose surfaces move no vertex the session holds. */
function readFacts(pages: readonly PageRec[], rasters: GraphRasters): RootFacts | undefined {
  let most = 0,
    always = false,
    moves = false
  for (const { material } of pages) {
    const program = material.graph && wpoProgramOf(material, rasters.textures, rasters.closures)
    if (!program || !rasters.offsets.includes(program)) continue
    moves = true
    most = Math.max(most, material.maxWorldPositionOffset ?? 0)
    always ||= material.alwaysEvaluateWorldPositionOffset === true
  }
  return moves ? { most, always } : undefined
}

/** What was read of a list of pages (the placements of a primitive share it), and the epoch of the
 *  surfaces' offset facts and the session's offsets it was read under. */
const read = new WeakMap<
  readonly PageRec[],
  { epoch: number; rasters: GraphRasters; facts: RootFacts | undefined }
>()

/** What the surfaces of `pages` ask (`readFacts`), read once for as long as the epoch stands. */
function factsOf(pages: readonly PageRec[], epoch: number, rasters: GraphRasters) {
  let held = read.get(pages)
  if (!held || held.epoch !== epoch || held.rasters !== rasters)
    read.set(pages, (held = { epoch, rasters, facts: readFacts(pages, rasters) }))
  return held.facts
}

/** The smallest scale of a root's world, which turns a distance in the world into the most it can
 *  be in the root's own units. */
function smallestScale({ world: { elements: e } }: ClusterRoot<PageRec>) {
  const axis = (at: number) => length3(e[at]!, e[at + 1]!, e[at + 2]!)
  return Math.max(Math.min(axis(0), axis(4), axis(8)), 1e-6)
}

/** The centre of a root's local bounds, in its primitive's space; the origin for a root with none. */
function boundsCentre(root: ClusterRoot<PageRec>, into: [number, number, number]) {
  const box = root.localBox
  const valid = !!box && box[3]! >= box[0]!
  for (let a = 0; a < 3; a++) into[a] = valid ? (box![a]! + box![3 + a]!) / 2 : 0
  return into
}

/** What an image last scanned: the epoch of the surfaces' facts, the roots and their count, the
 *  switches written and the session's offsets. */
interface Scanned {
  epoch: number
  roots: unknown
  length: number
  revision: number
  switches: number
  rasters: GraphRasters
}
const scanned = new WeakMap<object, Scanned>()

/** Whether the roots' offsets are to be read again: something they depend on moved since the last
 *  scan. */
function stale(rt: WebgpuPagesRuntime, epoch: number) {
  const last = scanned.get(rt.vis.rootOffsets),
    roots = rt.layout.selectionRoots,
    revision = rt.layout.rootIndex.revision,
    switches = offsetSwitchEdits(),
    { rasters } = rt.vis
  if (
    last &&
    last.epoch === epoch &&
    last.roots === roots &&
    last.length === roots.length &&
    last.revision === revision &&
    last.switches === switches &&
    last.rasters === rasters
  )
    return false
  scanned.set(rt.vis.rootOffsets, {
    epoch,
    roots,
    length: roots.length,
    revision,
    switches,
    rasters,
  })
  return true
}

/**
 * Follows the offsets of the session's roots for this image: reads them again where something they
 * depend on changed (`readRoots`), then declares to the shadow scheduler every root that casts and
 * whose node asks `always`, with its instance bounds alone: the pages its offset moves vertices in
 * are marked as the raster draws them.
 */
export function followOffsets(rt: WebgpuPagesRuntime) {
  if (stale(rt, rt.vis.materialTable.offsetEpoch)) readRoots(rt)
  for (const rank of rt.vis.rootOffsets.always())
    if (!(rt.lights.mobility.words[rank] & MOBILITY_SHADOWLESS)) noteDeformed(rt, rank, 0)
}

/** The switches that say what the views of its owner see of the object of `root`: its node's, the defaults for a row of a cell's
 *  instanced HLOD actor, which stands as its object's mesh but not as what its owner's views see of it. */
function switchesOfRoot(root: ClusterRoot<PageRec>, node: Object3D | undefined) {
  const switches = switchesOfObject(node)
  const at = root.placement && rowCell(root.placement.rows, root.placement.index)
  return at?.actor === undefined
    ? switches
    : { ...switches, ownerNoSee: false, onlyOwnerSee: false }
}

/** Reads the roots again: which wear an offset the session holds, their reach, the bits of their objects
 *  and the words of their rows — those of a root whose words changed written again. */
function readRoots(rt: WebgpuPagesRuntime) {
  const { rootOffsets: held, rasters, materialTable } = rt.vis,
    { viewHidden } = rt.layout,
    roots = rt.layout.selectionRoots,
    epoch = materialTable.offsetEpoch
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank]!,
      facts = factsOf(root.pages, epoch, rasters)
    const node = rootSource(root),
      switches = node && holdsOffsetSwitches(node) ? switchesOfRoot(root, node) : undefined
    // A root that wears no offset is held only to be declared every image (`always`), or to carry the bits of its
    // object (`objectBits`: first person, holdout, lets the contact shadow rays through, its lighting channels, what its
    // views see of it). A node that holds no switch has none of them.
    const row =
      facts ||
      switches?.shadowCache === 'always' ||
      (switches && (objectBits(switches) !== 0 || switches.renderCustomDepth))
        ? objectOffsetRow(node, boundsCentre(root, [0, 0, 0]), facts, switches)
        : undefined
    // Its bounds grow while its offset may be evaluated, wherever the camera is: the object’s own
    // switch off, no surface always evaluating, they do not.
    const reaches = !!facts && (row!.evaluate || row!.always)
    const grew = holdOffsetReach(rt, rank, reaches ? facts.most / smallestScale(root) : 0)
    const changed = held.hold(rank, row)
    // What its views see of it: the roots they may not draw follow it (`hiddenFromViews`); a bit already so changes nothing.
    viewHidden.setViewed(rank, ((row?.bits ?? 0) & OBJECT_VIEW_BITS) !== 0)
    // The words of its clusters changed — the switches of its object are its placement's record —,
    // or its reach: no pose moved.
    if (changed) {
      rt.layout.clusters.placementInfo.mark(rank)
      // The shadow raster reads the object's switches in the placement's mobility words.
      rt.lights.mobility.touch(rank)
    }
    if (grew || changed) markRootEntries(rt, root, 0, root.pages.length - 1)
  }
  // The roots the session no longer holds keep no row.
  held.shrink(roots.length)
  viewHidden.trim(roots.length)
  // The transparent items carry the same words in their records.
  const { blendState, gpu } = rt
  if (gpu.device && blendState.blendGpu.length) followBlendScene(rt, gpu.device)
}
