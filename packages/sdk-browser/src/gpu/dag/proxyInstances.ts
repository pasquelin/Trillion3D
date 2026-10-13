/**
 * THE PROXY KEPT TO THE PLACEMENTS IT TRACES: what a ray can meet of the scene beyond the visible cut
 * (`bounce/runtimeSceneWgsl.ts`) — the meshes the compiler built a proxy for (`proxy.bin`) and the cuts the
 * world made at run time, one structure. One buffer (`bounce/runtimeLayout.ts`) holds an instance of four
 * words a placement — written next to the culling's own rows, the same `w` —, one for each blended copy the
 * forward family draws (the members after the placements, their worlds in the buffer: they are no member of
 * the culling's tree), a surface a drawn material, the arena of the meshes' proxies, each uploaded once, when
 * a placement or a copy first wears it, and the mirror of the culling's placement tree (`mirror`). The
 * placements' worlds are the culling's, copied beside the tree (`mirror`), the rows written since the last copy alone: one storage binding reads the
 * whole proxy.
 *
 * A mesh's proxy reaches a placement through its primitive (`RootProxy.primitive`): a cut's at its making, a
 * compiled mesh's when the cache object arrives (`arrived`), which writes every instance again.
 *
 * A member of the run (`runtime.ts`): its operations tell it what moved — roots appended, a
 * placement parked or marked — and each cut refreshes the surfaces a host edited and the copies that
 * moved since. Without a placement or a copy that wears a proxy, no buffer is made and `buffers`
 * answers none: the trace reads its empty stand-ins.
 */
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/index.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { SQRT3 } from '../../../../math/src/constants.ts'
import { boxTransform } from '../../../../math/src/geometry/box.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import {
  longestColumn,
  sameElements,
  sameMatrixFloat32,
} from '../../../../math/src/matrix/matrixElements.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { createChangedRuns } from '../../webgpu/residency/ranges.ts'
import { constructGpuResources } from '../core/errorScope.ts'
import type { ProxyBoxes } from '../../bounce/probeSync.ts'
import { refreshSurface, type PageSurface } from '../../page/surface.ts'
import type { RootProxy } from '../../page/selection/types.ts'
import { rowParked, type PlacementOf } from '../../placement/rows.ts'
import { createSpans } from '../../bounce/spans.ts'
import { pendingMade } from '../core/tableGrowth.ts'
import { createProxyPose, type PoseEntry } from './proxyPose.ts'
import {
  INSTANCE,
  INSTANCE_WORDS,
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  RUNTIME_NONE,
  SURFACE_WORDS,
} from '../../bounce/runtimeLayout.ts'
import { NO_TINT, writeSurface } from '../../bounce/runtimeSurface.ts'
import type { DagParts } from './split.ts'
import { treeNodeCount } from './placementTree.ts'
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './types.ts'

/** The step between two rows of world one copy still takes (the rows between rewritten as they are),
 *  and the copies a mirror takes at most: past them the narrowest gaps are joined (`createChangedRuns`). */
const WORLD_RUN_GAP = 5,
  WORLD_RUNS = 128
/** A proxy's cell to the distance a ray leaves a surface by: half the cell's diagonal, the codec's
 *  `CELL_ERROR_FACTOR` (`page-codec-wasm/src/proxy/simplify.rs`). */
const CELL_ERROR_FACTOR = SQRT3 / 2

/** The world matrices are sixteen words each in the cut's worlds, the exact translations behind. */
const WORLD_WORDS = 16,
  WORLD_BYTES = WORLD_WORDS * 4
/** Cuts, surfaces, triangles and nodes a first buffer is laid out for: doubled as needed. */
const START = { surfaces: 16, triangles: 4096, nodes: 1024, corners: 4096 }

type Resources = {
  device: GPUDevice
  packed: PackedDag
  nodeParts: DagParts
  coldParts: DagParts
  frames: {
    ranges: readonly { first: number; count: number }[]
    worldBuffers: readonly GPUBuffer[]
  }
}

/** A blended copy as the proxy reads it: its cut and surface, the pose it aliases and whether it is
 *  drawn (`BlendCopy`). */
export type ProxyCopy = {
  proxy?: RootProxy
  matrix: { readonly elements: ArrayLike<number> }
  hidden?: boolean
  placement?: PlacementOf
}

/** Where a proxy lies in the arena: its first node and triangle, and what it holds. */
type Placed = {
  node: number
  triangle: number
  nodes: number
  triangles: number
  /** A mesh that deforms: where its corner table lies among the corner words, and how many. */
  corner?: number
  corners: number
}

/** The copy of a mesh's proxy a deformed placement owns, which the pose moves (`proxyPose.ts`). */
type Posed = {
  cut: RuntimeCutProxy
  placed: Placed
  node: number
  triangle: number
}

/** What the pose reads of the deformation (`deformation/session.ts`): the float pool its records lie in, each
 *  placement's record in it (the first float plus one, zero for none) and the revision of the records. */
export type PoseHost = {
  pool: GPUBuffer | undefined
  recordOf(world: object): number
  revision: number
}

/** A surface slot: the words it holds are those of a version of its record, under a tint. */
type Held = { slot: number; version: number; at: number }

/** The part of a table split in parts of `per` elements that holds elements `[first, first + count)`
 *  whole, or `undefined` where two parts share them. */
function partOf(first: number, count: number, per: number) {
  const part = Math.floor(first / per)
  return Math.floor((first + Math.max(count, 1) - 1) / per) === part ? part : undefined
}

export function createProxyInstances({ device, packed, nodeParts, coldParts, frames }: Resources) {
  const tree = packed.placementTree
  const slots = Math.max(1, packed.worldCount)
  // The tree is read from the parts that hold its nodes and its members' order; a tree that straddles
  // two parts is not read, and its placements are walked as they come: the work budget bounds the walk.
  const nodePart =
      tree && partOf(tree.cellBase, treeNodeCount(tree), nodeParts.bytes / (DAG_NODE_FLOATS * 4)),
    coldPart = tree && partOf(tree.members, tree.capacity, coldParts.bytes / 4)
  const walksTree = nodePart !== undefined && coldPart !== undefined
  // The tree's nodes and its members' order as the mirror holds them (`mirror`).
  const treeWords = walksTree ? treeNodeCount(tree) * DAG_NODE_FLOATS : 0,
    memberWords = walksTree ? tree!.capacity : 0
  const nodesFirst = walksTree ? nodePart * (nodeParts.bytes / (DAG_NODE_FLOATS * 4)) : 0,
    coldFirst = walksTree ? coldPart * (coldParts.bytes / 4) : 0
  let words = new Uint32Array(slots * INSTANCE_WORDS).fill(RUNTIME_NONE)
  // The instance a placement wears now, and the one it keeps while parked.
  const resolved = new Uint32Array(slots * INSTANCE_WORDS).fill(RUNTIME_NONE)
  const cuts = new Map<RuntimeCutProxy, Placed>(),
    surfaces = new Map<PageSurface, Map<number, Held>>()
  let surfaceCount = 0
  const triangles = createSpans(START.triangles),
    nodes = createSpans(START.nodes),
    corners = createSpans(START.corners)
  const posed = new Map<number, Posed>()
  const pose = createProxyPose(device)
  let posedRevision = -1
  // The poses as the pose reads them, kept while the copies and where they lie stay (`poseLayout`):
  // laid again when a copy is made or given back, or the tables are laid out again.
  const poseEntries: PoseEntry[] = [],
    poseRoots: DagRoot[] = []
  let poseLayout = 0,
    entriesLayout = -1,
    poseFresh = false
  let copies: readonly ProxyCopy[] = [],
    copyWorlds = new Float32Array(0),
    surfaceCapacity = START.surfaces,
    revision = 0,
    error = 0,
    buffer: GPUBuffer | undefined,
    layout = layoutOf(),
    surfaceWords = new Uint32Array(surfaceCapacity * SURFACE_WORDS),
    dirty = true

  function layoutOf() {
    const instances = 0,
      worldsAt = instances + (slots + copies.length) * INSTANCE_WORDS,
      copyWorldsAt = worldsAt + slots * WORLD_WORDS,
      surfacesAt = copyWorldsAt + copies.length * WORLD_WORDS,
      trianglesAt = surfacesAt + surfaceCapacity * SURFACE_WORDS,
      boundsAt = trianglesAt + triangles.capacity * PROXY_TRIANGLE_FLOATS,
      childrenAt = boundsAt + nodes.capacity * PROXY_NODE_FLOATS,
      treeAt = childrenAt + nodes.capacity * PROXY_NODE_WORDS,
      membersAt = treeAt + treeWords,
      deformAt = membersAt + memberWords
    return {
      instances,
      worlds: worldsAt,
      copyWorlds: copyWorldsAt,
      surfaces: surfacesAt,
      triangles: trianglesAt,
      bounds: boundsAt,
      children: childrenAt,
      tree: treeAt,
      members: membersAt,
      deform: deformAt,
      total: deformAt + corners.capacity,
    }
  }
  const byteAt = (word: number) => (RUNTIME_HEADER_WORDS + word) * 4
  /** Every write to the buffer: what a ray can meet changed, so its answers are of another epoch. */
  const send: GPUQueue['writeBuffer'] = (...args) => {
    revision++
    device.queue.writeBuffer(...args)
  }

  // The world rows written since the mirror last copied them, in the engine's one changed list: a still
  // world copies nothing. A buffer new made holds none of them (`ensure`), and takes them all.
  const mirrored = createChangedRuns(slots, WORLD_RUN_GAP, WORLD_RUNS)
  let worldsAll = true
  // The tree's revision the mirror last copied (`TreeFollower.revision`): a still tree copies nothing.
  let treeCopied = NaN

  // The placements' world boxes, for the probes' occupancy map (`bounce/probes.ts`), kept from call to call:
  // a placement's box is its mesh's root bounds through the world it stands at, made again only for a row
  // written since (`boxed`) whose world or proxy moved, the rows whose box did listed (`moved`), the extent
  // kept as the boxes change. A row that wears no proxy holds the empty box.
  const boxes = new Float64Array(slots * 6),
    boxedWorlds = new Float64Array(slots * 16),
    boxedCuts: (RuntimeCutProxy | undefined)[] = new Array(slots)
  for (let w = 0; w < slots; w++)
    boxes.fill(Infinity, w * 6, w * 6 + 3).fill(-Infinity, w * 6 + 3, w * 6 + 6)
  const boxed = createChangedRuns(slots, 1),
    movedBoxes = createChangedRuns(slots, 1)
  const extent = [0, 0, 0, 0, 0, 0]
  // Whether the extent was found again since a box that held its edge moved, and holds a box.
  let extentStale = true,
    extentHolds = false

  /** Row `w` of the culling's world table was written: its mirror is copied at the next `mirror`, its box
   *  made again at the next `worldBoxes`. */
  function worldWritten(w: number) {
    if (w < 0 || w >= slots) return
    boxed.mark(w)
    if (!worldsAll) mirrored.mark(w)
  }

  /** The rows of the culling's world table the buffer mirrors: the first range's, as many as it holds. */
  const worldRows = () => Math.min(frames.ranges[0]?.count ?? 0, slots)

  const head = new Uint32Array(RUNTIME_HEADER_WORDS),
    headFloats = new Float32Array(head.buffer)
  /** The header, as it stands. */
  function header() {
    const at = RUNTIME_HEADER
    head[at.instances] = slots
    head[at.instancesWord] = layout.instances
    head[at.surfacesWord] = layout.surfaces
    head[at.trianglesWord] = layout.triangles
    head[at.copyWorldsWord] = layout.copyWorlds
    head[at.boundsWord] = layout.bounds
    head[at.childrenWord] = layout.children
    head[at.treeRoot] = walksTree ? tree!.levels[0].base : RUNTIME_NONE
    head[at.treeFirst] = walksTree ? tree!.cellBase : 0
    head[at.treeWord] = layout.tree
    head[at.membersWord] = layout.members
    head[at.members] = walksTree ? tree!.count : packed.worldSources.length
    head[at.worldsWord] = layout.worlds
    head[at.worldRows] = worldRows()
    headFloats[at.error] = error
    head[at.copies] = copies.length
    return head
  }

  /** The buffer, made at the first need with everything the CPU holds written into it. */
  function ensure() {
    if (buffer) return buffer
    worldsAll = true
    treeCopied = NaN
    mirrored.clear()
    // Made in the device's ledger, as every resource the engine allocates (`constructGpuResources`).
    const made = constructGpuResources(device, () =>
      device.createBuffer({
        label: 'Trillion3D run-time proxy',
        size: byteAt(layout.total),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      }),
    )
    buffer = made
    send(made, 0, header())
    send(made, byteAt(layout.instances), words)
    if (copyWorlds.length) send(made, byteAt(layout.copyWorlds), copyWorlds)
    send(made, byteAt(layout.surfaces), surfaceWords, 0, surfaceCapacity * SURFACE_WORDS)
    return made
  }

  /** The tables laid out again — `want` more triangles, nodes, surfaces, or a copy more or fewer —:
   *  the buffer replaced by one the new layout fits, the columns it held carried over by copies. */
  function relayout(
    want: { triangles?: number; nodes?: number; surfaces?: number; corners?: number } = {},
  ) {
    triangles.grown(want.triangles ?? 0)
    nodes.grown(want.nodes ?? 0)
    corners.grown(want.corners ?? 0)
    const before = layout
    surfaceCapacity = Math.max(surfaceCapacity, want.surfaces ?? 0)
    surfaceWords = resized(surfaceWords, surfaceCapacity * SURFACE_WORDS)
    layout = layoutOf()
    poseLayout++
    const old = buffer
    buffer = undefined
    if (!old) return
    const made = ensure()
    const encoder = device.createCommandEncoder({ label: 'Trillion3D run-time proxy growth' })
    const copy = (from: number, to: number, count: number) =>
      count > 0 && encoder.copyBufferToBuffer(old, byteAt(from), made, byteAt(to), count * 4)
    copy(before.triangles, layout.triangles, triangles.extent * PROXY_TRIANGLE_FLOATS)
    copy(before.bounds, layout.bounds, nodes.extent * PROXY_NODE_FLOATS)
    copy(before.children, layout.children, nodes.extent * PROXY_NODE_WORDS)
    copy(before.deform, layout.deform, corners.extent)
    device.queue.submit([encoder.finish()])
    // The old buffer may be recorded in commands of this image not yet submitted, or held by a group in
    // flight: it is freed when the work submitted by then is done, the one growth transaction
    // (`gpu/core/tableGrowth.ts`) with its free deferred.
    pendingMade(
      old,
      old.size,
      (held) => void device.queue.onSubmittedWorkDone().then(() => held.destroy()),
      () => old,
    ).commit()
  }

  /** `count` units of each table taken, the tables laid out again when one cannot hold them: the spans, or
   *  none where the arena cannot be made larger (the engine's own refusal then says why). */
  function taken(triangleCount: number, nodeCount: number, cornerCount = 0) {
    const take = () => [
      triangles.take(triangleCount),
      nodes.take(nodeCount),
      corners.take(cornerCount),
    ]
    let [triangle, node, corner] = take()
    if (triangle === undefined || node === undefined || corner === undefined) {
      if (triangle !== undefined) triangles.release(triangle, triangleCount)
      if (node !== undefined) nodes.release(node, nodeCount)
      if (corner !== undefined) corners.release(corner, cornerCount)
      relayout({
        triangles: triangles.extent + triangleCount,
        nodes: nodes.extent + nodeCount,
        corners: corners.extent + cornerCount,
      })
      ;[triangle, node, corner] = take()
    }
    return triangle === undefined || node === undefined || corner === undefined
      ? undefined
      : { triangle, node, corner }
  }

  /** `cut`'s triangles, bounds and children sent to the arena from triangle `triangle` and node `node`. */
  function uploadColumns(cut: RuntimeCutProxy, triangle: number, node: number) {
    const made = ensure()
    send(made, byteAt(layout.triangles + triangle * PROXY_TRIANGLE_FLOATS), cut.triangles)
    send(made, byteAt(layout.bounds + node * PROXY_NODE_FLOATS), cut.nodeBounds)
    send(made, byteAt(layout.children + node * PROXY_NODE_WORDS), cut.nodeChildren)
    return made
  }

  /** A mesh's columns in the arena, uploaded the first time a placement wears it. */
  function place(cut: RuntimeCutProxy): Placed | undefined {
    const known = cuts.get(cut)
    if (known) return known
    const triangleCount = cut.triangles.length / PROXY_TRIANGLE_FLOATS,
      nodeCount = cut.nodeBounds.length / PROXY_NODE_FLOATS,
      cornerCount = cut.deform?.corners.length ?? 0
    if (!triangleCount || !nodeCount) return undefined
    const got = taken(triangleCount, nodeCount, cornerCount)
    if (!got) return undefined
    const { triangle, node, corner } = got
    const made = uploadColumns(cut, triangle, node)
    if (cut.deform) send(made, byteAt(layout.deform + corner), cut.deform.corners)
    const placed = {
      node,
      triangle,
      nodes: nodeCount,
      triangles: triangleCount,
      corners: cornerCount,
      ...(cut.deform ? { corner } : {}),
    }
    cuts.set(cut, placed)
    return placed
  }

  /** The copy of `placed`'s mesh that placement `w` owns, which the pose moves: its triangles and nodes in
   *  the arena, the rest shape to begin with. */
  function posedCopy(w: number, cut: RuntimeCutProxy, placed: Placed) {
    const held = posed.get(w)
    if (held?.cut === cut) return held
    if (held) dropPosed(w)
    const got = taken(placed.triangles, placed.nodes)
    if (!got) return undefined
    uploadColumns(cut, got.triangle, got.node)
    const copy = { cut, placed, node: got.node, triangle: got.triangle }
    posed.set(w, copy)
    poseLayout++
    poseFresh = true
    return copy
  }

  /** Placement `w` stands at its mesh's rest shape again: its copy is given back. */
  function dropPosed(w: number) {
    const copy = posed.get(w)
    if (!copy) return
    triangles.release(copy.triangle, copy.placed.triangles)
    nodes.release(copy.node, copy.placed.nodes)
    posed.delete(w)
    poseLayout++
  }

  /** A surface's slot under a tint (`NO_TINT`: its own), its words written the first time and each time
   *  its record moved on. */
  function surfaceSlot(host: PageSurface, tint: number) {
    // The record the host last wrote: read again when its version moved.
    const surface = refreshSurface(host)
    let tints = surfaces.get(host)
    if (!tints) surfaces.set(host, (tints = new Map()))
    let held = tints.get(tint)
    if (!held) {
      if (surfaceCount === surfaceCapacity) relayout({ surfaces: surfaceCapacity * 2 })
      held = { slot: surfaceCount, version: NaN, at: surfaceCount * SURFACE_WORDS }
      surfaceCount++
      tints.set(tint, held)
    }
    if (held.version !== surface.version || !Number.isFinite(held.version)) {
      held.version = surface.version
      writeSurface(surfaceWords, held.at, surface, tint)
      if (buffer)
        send(buffer, byteAt(layout.surfaces + held.at), surfaceWords, held.at, SURFACE_WORDS)
    }
    return held.slot
  }

  /** The tint a mesh's proxy brings: the compiler's colour of its material, `NO_TINT` for a cut's white. */
  const tintOf = (cut: RuntimeCutProxy) => (cut.albedo.length ? cut.albedo[0] : NO_TINT)

  /** The error of a proxy at a pose: the distance a ray leaves a surface off its normal. */
  function noteError(cell: number, m: ArrayLike<number>, at: number) {
    const world = cell * CELL_ERROR_FACTOR * longestColumn(m, at)
    if (world > error) {
      error = world
      dirty = true
    }
  }

  /** A placement's mark as its instance holds it: a posed one is traced where the deformation put it, so the
   *  reach the mark carries above its flags, which tells how far its rest shape can be from there, goes. */
  const markOf = (w: number, mark: number) => (posed.has(w) ? mark & 0xffff : mark)

  /** The instance words of placement `w`, from the root it holds, parked or not. */
  function resolve(w: number) {
    const root = packed.worldSources[w] as DagRoot | undefined,
      at = w * INSTANCE_WORDS
    const proxy = root?.proxy
    const cut = proxy?.primitive.runtimeProxy
    const placed = cut && place(cut)
    if (!proxy || !cut || !placed) {
      resolved.fill(RUNTIME_NONE, at, at + INSTANCE_WORDS)
      resolved[at + INSTANCE.mark] = 0
      return
    }
    // A placement whose mesh deforms stands at its own copy, which the pose moves; the others share the mesh's.
    const copy = cut.deform && placed.corner !== undefined ? posedCopy(w, cut, placed) : undefined
    if (!copy) dropPosed(w)
    resolved[at + INSTANCE.node] = copy?.node ?? placed.node
    resolved[at + INSTANCE.triangle] = copy?.triangle ?? placed.triangle
    resolved[at + INSTANCE.surface] = surfaceSlot(proxy.surface, tintOf(cut))
    resolved[at + INSTANCE.mark] = markOf(w, packed.mark[w] ?? 0)
    noteError(cut.cellMetres, packed.worlds, w * 16)
  }

  /** Placements `[from, to)` written: what they wear, parked ones none until they are taken back. */
  function write(from: number, to: number) {
    for (let w = from; w < to; w++) {
      boxed.mark(w)
      resolve(w)
      const at = w * INSTANCE_WORDS,
        parked = packed.rootNodes[w] === RUNTIME_NONE
      words.set(resolved.subarray(at, at + INSTANCE_WORDS), at)
      if (parked) words[at + INSTANCE.node] = RUNTIME_NONE
    }
    if (buffer || cuts.size) {
      const made = ensure()
      send(
        made,
        byteAt(layout.instances + from * INSTANCE_WORDS),
        words,
        from * INSTANCE_WORDS,
        (to - from) * INSTANCE_WORDS,
      )
      send(made, 0, header())
      dirty = false
    }
  }

  /** Instance word `at` set to `word`: whether it moved. */
  function setWord(at: number, word: number) {
    if (words[at] === word) return false
    words[at] = word
    return true
  }

  /** The copies' instances and poses, as the host holds them now: written where one moved, was shown or
   *  hidden, or wears another cut. */
  function syncCopies() {
    let moved = false
    copies.forEach((copy, k) => {
      const at = (slots + k) * INSTANCE_WORDS,
        proxy = copy.proxy
      const cut = proxy?.primitive.runtimeProxy
      const placed = cut && place(cut)
      const shown = !!placed && !copy.hidden && !rowParked(copy.placement)
      moved = setWord(at + INSTANCE.node, shown ? placed.node : RUNTIME_NONE) || moved
      moved = setWord(at + INSTANCE.triangle, shown ? placed.triangle : 0) || moved
      moved =
        setWord(at + INSTANCE.surface, shown ? surfaceSlot(proxy.surface, tintOf(cut)) : 0) || moved
      moved = setWord(at + INSTANCE.mark, 0) || moved
      if (!shown) return
      const world = copy.matrix.elements
      if (!sameMatrixFloat32(copyWorlds, world, k * WORLD_WORDS)) {
        copyMatrix4(copyWorlds, world, k * WORLD_WORDS)
        moved = true
      }
      noteError(cut.cellMetres, world, 0)
    })
    if (!moved || !copies.length || !(buffer || cuts.size)) return
    const made = ensure()
    send(
      made,
      byteAt(layout.instances + slots * INSTANCE_WORDS),
      words,
      slots * INSTANCE_WORDS,
      copies.length * INSTANCE_WORDS,
    )
    send(made, byteAt(layout.copyWorlds), copyWorlds)
  }

  const live = () => packed.live?.worlds ?? packed.worldSources.length
  write(0, live())

  /** Placement `w`'s box made again where its world or its proxy moved: whether it did. */
  function rebox(w: number) {
    const root = packed.worldSources[w] as DagRoot | undefined
    const cut = root?.proxy?.primitive.runtimeProxy
    const at = w * 6
    const wears =
      w < live() && !!root && !!cut?.nodeBounds.length && packed.rootNodes[w] !== RUNTIME_NONE
    if (!wears) {
      if (!boxedCuts[w]) return false
      boxedCuts[w] = undefined
      boxes.fill(Infinity, at, at + 3).fill(-Infinity, at + 3, at + 6)
      return true
    }
    const m = root!.world.elements
    if (boxedCuts[w] === cut && sameElements(boxedWorlds, m, w * 16)) return false
    boxedCuts[w] = cut
    copyMatrix4(boxedWorlds, m, w * 16)
    boxTransform(boxes, at, cut!.nodeBounds, 0, m)
    return true
  }

  /** Whether box `w`, before it changes, touches the extent: the extent is then found again. */
  function onEdge(w: number) {
    for (let axis = 0; axis < 3; axis++)
      if (boxes[w * 6 + axis] === extent[axis] || boxes[w * 6 + 3 + axis] === extent[3 + axis])
        return true
    return false
  }

  /** The extent of every box, found again: zeros without a box. */
  function fitExtent() {
    extent.fill(0)
    let first = true
    for (let w = 0; w < slots; w++) {
      if (!boxedCuts[w]) continue
      for (let axis = 0; axis < 3; axis++) {
        const low = boxes[w * 6 + axis],
          high = boxes[w * 6 + 3 + axis]
        extent[axis] = first ? low : Math.min(extent[axis], low)
        extent[3 + axis] = first ? high : Math.max(extent[3 + axis], high)
      }
      first = false
    }
    extentHolds = !first
  }

  /** The boxes made again for the rows written since the last call (`boxed`), and the runs of those
   *  whose box moved: the work follows them, never the placements' count — the extent alone is found
   *  again over every box, when a box that held its edge moved. */
  function worldBoxes(): ProxyBoxes {
    const { count, pairs } = boxed.runs()
    for (let r = 0; r < count; r++)
      for (let w = pairs[2 * r]; w <= pairs[2 * r + 1]; w++) {
        const edge = !!boxedCuts[w] && onEdge(w)
        if (!rebox(w)) continue
        movedBoxes.mark(w)
        if (edge || extentStale || !extentHolds || !boxedCuts[w]) {
          extentStale ||= edge || (!extentHolds && !!boxedCuts[w])
          continue
        }
        for (let axis = 0; axis < 3; axis++) {
          extent[axis] = Math.min(extent[axis], boxes[w * 6 + axis])
          extent[3 + axis] = Math.max(extent[3 + axis], boxes[w * 6 + 3 + axis])
        }
      }
    boxed.clear()
    if (extentStale) fitExtent()
    extentStale = false
    const moved = movedBoxes.runs()
    const result = {
      boxes,
      moved: { count: moved.count, pairs: moved.pairs },
      extent: extent.slice(),
    }
    movedBoxes.clear()
    return result
  }

  return {
    /** The buffer a program reads the proxy through, or none: it then reads the stand-ins. */
    buffer() {
      return buffer
    },
    /**
     * The placements' worlds and the placement tree copied into the proxy's buffer, in `encoder`, before the
     * first program of the image that traces it: sixty-four bytes of world a row written since the last copy — a
     * still world copies none —, and the tree's nodes, as
     * the culling's refit left them, and the order of its members, a few hundred kilobytes at a quarter of a
     * million placements; no tree copies nothing to walk.
     */
    mirror(encoder: GPUCommandEncoder, treeRevision: number) {
      if (!buffer) return
      const rows = worldRows(),
        source = frames.worldBuffers[0]
      if (rows > 0 && source) {
        const into = buffer
        const copy = (from: number, to: number) =>
          from < to &&
          encoder.copyBufferToBuffer(
            source,
            from * WORLD_BYTES,
            into,
            byteAt(layout.worlds) + from * WORLD_BYTES,
            (to - from) * WORLD_BYTES,
          )
        if (worldsAll) copy(0, rows)
        else {
          const { count, pairs } = mirrored.runs()
          for (let r = 0; r < count; r++) copy(pairs[2 * r], Math.min(pairs[2 * r + 1] + 1, rows))
        }
      }
      mirrored.clear()
      worldsAll = false
      if (!walksTree || !tree || treeRevision === treeCopied) return
      treeCopied = treeRevision
      encoder.copyBufferToBuffer(
        nodeParts.buffers[nodePart!],
        (tree.cellBase - nodesFirst) * DAG_NODE_FLOATS * 4,
        buffer,
        byteAt(layout.tree),
        treeWords * 4,
      )
      encoder.copyBufferToBuffer(
        coldParts.buffers[coldPart!],
        (tree.members - coldFirst) * 4,
        buffer,
        byteAt(layout.members),
        memberWords * 4,
      )
    },
    /** The world box of each placement that wears a proxy, and which of them are new or moved since the last
     *  call: what the probes' occupancy map keeps (`bounce/probes.ts`). */
    worldBoxes,
    /**
     * The deformed placements' copies posed, in `encoder`, before the first program of the image that traces
     * them: when the deformation's records moved (`host.revision`) or a copy is new, and once the pose's
     * program is built. Their answers are of another epoch from then on.
     */
    pose(encoder: GPUCommandEncoder, host: PoseHost) {
      if (!buffer || !posed.size || !host.pool) return
      if (host.revision === posedRevision && !poseFresh) return
      if (entriesLayout !== poseLayout) {
        entriesLayout = poseLayout
        poseEntries.length = poseRoots.length = 0
        for (const [w, copy] of posed) {
          poseRoots.push(packed.worldSources[w] as DagRoot)
          poseEntries.push({
            cut: copy.cut,
            restTriangle: copy.placed.triangle,
            posedTriangle: copy.triangle,
            posedNode: copy.node,
            corners: layout.deform + copy.placed.corner!,
            record: 0,
          })
        }
      }
      for (let k = 0; k < poseEntries.length; k++)
        poseEntries[k].record = host.recordOf(poseRoots[k].world)
      if (!pose.run(encoder, buffer, host.pool, poseEntries, poseLayout)) return
      posedRevision = host.revision
      poseFresh = false
      revision++
    },
    /** The meshes' proxies of a compiled scene arrived (`RootProxy.primitive.runtimeProxy` was set): every
     *  placement wears what its primitive holds now. */
    arrived() {
      write(0, live())
    },
    /** Rows `rows[0..count)` of the culling's world table were written (a pose, a park, a composition under a
     *  moved parent): the mirror copies those and no other. */
    worldsWritten(rows: ArrayLike<number>, count = rows.length) {
      for (let k = 0; k < count; k++) worldWritten(rows[k])
    },
    /** Row `w` of it was written. */
    worldWritten,
    /** Rows `[from, to)` of it were written, appended roots' worlds among them. */
    worldsRange(from: number, to: number) {
      for (let w = from; w < to && !worldsAll; w++) worldWritten(w)
    },
    /** Roots `[from, to)` were appended behind the others: their instances, and the tree's members. */
    appended: write,
    /** The blended copies the forward family draws, members of this proxy after the placements: their
     *  poses are the host's (`BlendCopy.matrix`), read again at each cut. */
    setCopies(next: readonly ProxyCopy[]) {
      const held = copyWorlds.length / WORLD_WORDS
      if (next === copies && next.length === held) return
      if (next.length !== held) {
        const kept = words.subarray(0, slots * INSTANCE_WORDS)
        copies = next
        words = new Uint32Array((slots + copies.length) * INSTANCE_WORDS).fill(RUNTIME_NONE)
        words.set(kept)
        copyWorlds = new Float32Array(copies.length * WORLD_WORDS)
        relayout()
      } else copies = next
      syncCopies()
    },
    /** Placement `w` parked, or taken back. */
    park(w: number, parked: boolean) {
      if (w >= slots) return
      boxed.mark(w)
      if (!buffer) return
      const at = w * INSTANCE_WORDS,
        node = parked ? RUNTIME_NONE : resolved[at + INSTANCE.node]
      if (words[at + INSTANCE.node] === node) return
      words[at + INSTANCE.node] = node
      send(buffer, byteAt(layout.instances + at + INSTANCE.node), words, at + INSTANCE.node, 1)
    },
    /** Placement `w`'s frame word, its mark and the deformation's reach above it. */
    mark(w: number, mark: number) {
      if (!buffer || w >= slots) return
      const at = w * INSTANCE_WORDS + INSTANCE.mark,
        held = markOf(w, mark)
      resolved[at] = held
      if (words[at] === held) return
      words[at] = held
      send(buffer, byteAt(layout.instances + at), words, at, 1)
    },
    /** The surfaces a host edited and the copies that moved since the last cut, written again. */
    refresh() {
      if (!buffer && !copies.length) return
      for (const [surface, tints] of surfaces)
        for (const tint of tints.keys()) surfaceSlot(surface, tint)
      syncCopies()
      if (buffer && dirty) {
        send(buffer, 0, header())
        dirty = false
      }
    },
    /** Writes made to the buffer so far: the answers it gave are of an older one when this moved. */
    get revision() {
      return revision
    },
    /** Bytes the CPU keeps for the proxy: the instance words as written and as resolved, the surface and copy
     *  words, the world boxes and the flags of the mirror (the cuts' columns are the primitives', counted with
     *  the scene proxy's cache object). What the streamer's reservation counts. */
    get hostBytes() {
      return (
        words.byteLength +
        resolved.byteLength +
        surfaceWords.byteLength +
        copyWorlds.byteLength +
        boxes.byteLength +
        boxedWorlds.byteLength +
        // The changed lists' marks, a byte a row each.
        3 * slots
      )
    },
    /** Bytes of the buffer: what the cut's memory budget counts. */
    get bytes() {
      return buffer?.size ?? 0
    },
    dispose() {
      buffer?.destroy()
      buffer = undefined
      pose.dispose()
    },
  }
}
export type ProxyInstances = ReturnType<typeof createProxyInstances>
