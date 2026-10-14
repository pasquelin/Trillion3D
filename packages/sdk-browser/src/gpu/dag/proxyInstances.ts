/**
 * THE PROXY KEPT TO THE PLACEMENTS IT TRACES: what a ray can meet of the scene beyond the visible cut
 * (`bounce/runtimeSceneWgsl.ts`) — the meshes the compiler built a proxy for (`proxy.bin`) and the cuts the
 * world made at run time, one structure. Its instances — four words a placement, written next to the
 * culling's own rows, the same `w`, then one for each blended copy the forward family draws (the members
 * after the placements: they are no member of the culling's tree) — are the `Instance` field of the
 * culling's records (`worldTable.ts`), beside each placement's world, whatever the world's size: the table
 * grows for the copies (`RecordTexture.hold`). One buffer (`bounce/runtimeLayout.ts`) holds the rest,
 * bounded by the meshes, not by the placements: the copies' worlds, a surface a drawn material, and the
 * arena of the meshes' proxies, each uploaded once, when a placement or a copy first wears it. The
 * placements' worlds and the placement tree are the culling's, read where they lie (`worldTable.ts`,
 * `treeTable.ts`): nothing of them is copied.
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
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { SQRT3, NO_INDEX } from '../../../../math/src/constants.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { longestColumn, sameMatrixFloat32 } from '../../../../math/src/matrix/matrixElements.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { constructGpuResources } from '../core/errorScope.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { RootProxy } from '../../page/selection/types.ts'
import { rowParked, type PlacementOf } from '../../placement/rows.ts'
import { createSpans } from '../../bounce/spans.ts'
import { retire } from '../core/frameRetire.ts'
import { createProxyPose, type PoseEntry } from './proxyPose.ts'
import { createProxyBoxes } from './proxyBoxes.ts'
import {
  INSTANCE,
  INSTANCE_WORDS,
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  RUNTIME_WORLD_WORDS,
  SURFACE_WORDS,
} from '../../bounce/runtimeLayout.ts'
import { NO_TINT, writeSurface } from '../../bounce/runtimeSurface.ts'
import type { RecordTexture } from '../core/recordTexture.ts'
import type { DagRoot, PackedDag } from './types.ts'

/** A proxy's cell to the distance a ray leaves a surface by: half the cell's diagonal, the codec's
 *  `CELL_ERROR_FACTOR` (`page-codec-wasm/src/proxy/simplify.rs`). */
const CELL_ERROR_FACTOR = SQRT3 / 2

/** A blended copy's world matrix, sixteen words. */
const WORLD_WORDS = RUNTIME_WORLD_WORDS
/** Cuts, surfaces, triangles and nodes a first buffer is laid out for: doubled as needed. */
const START = { surfaces: 16, triangles: 4096, nodes: 1024, corners: 4096 }
const LABEL = 'Trillion3D run-time proxy'

/** A write's arguments past the buffer it lands in (`GPUQueue.writeBuffer`). */
type WriteArgs =
  Parameters<GPUQueue['writeBuffer']> extends [GPUBuffer, ...infer Rest] ? Rest : never

type Resources = {
  device: GPUDevice
  packed: PackedDag
  /** The culling's records, whose `Instance` field the instances are (`worldTable.ts`). */
  frames: { worlds: RecordTexture }
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

export function createProxyInstances({ device, packed, frames }: Resources) {
  const tree = packed.placementTree
  const slots = Math.max(1, packed.worldCount)
  let words = new Uint32Array(slots * INSTANCE_WORDS).fill(NO_INDEX)
  // The instance a placement wears now, and the one it keeps while parked.
  const resolved = new Uint32Array(slots * INSTANCE_WORDS).fill(NO_INDEX)
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
    poseKeys: number[] = []
  let poseLayout = 0,
    entriesLayout = -1,
    poseFresh = false
  let copies: readonly ProxyCopy[] = [],
    copyWorlds = new Float32Array(0),
    surfaceCapacity = START.surfaces,
    error = 0,
    buffer: GPUBuffer | undefined,
    layout = layoutOf(),
    surfaceWords = new Uint32Array(surfaceCapacity * SURFACE_WORDS),
    dirty = true

  function layoutOf() {
    const copyWorldsAt = 0,
      surfacesAt = copyWorldsAt + copies.length * WORLD_WORDS,
      trianglesAt = surfacesAt + surfaceCapacity * SURFACE_WORDS,
      boundsAt = trianglesAt + triangles.capacity * PROXY_TRIANGLE_FLOATS,
      childrenAt = boundsAt + nodes.capacity * PROXY_NODE_FLOATS,
      deformAt = childrenAt + nodes.capacity * PROXY_NODE_WORDS
    return {
      copyWorlds: copyWorldsAt,
      surfaces: surfacesAt,
      triangles: trianglesAt,
      bounds: boundsAt,
      children: childrenAt,
      deform: deformAt,
      total: deformAt + corners.capacity,
    }
  }
  const byteAt = (word: number) => (RUNTIME_HEADER_WORDS + word) * 4
  /** Every write to the buffer. No buffer, no write. */
  const send = (target: GPUBuffer | undefined, ...args: WriteArgs) => {
    if (!target) return
    device.queue.writeBuffer(target, ...args)
  }
  // The instances, the `Instance` field of the culling's records (`worldTable.ts`): written whole
  // with the buffer, then the runs that moved; the table grown when the copies outgrow it.
  const records = frames.worlds
  let instancesSent = false
  /** The instances `[first, first + count)` of `words` the records hold, to them. */
  function writeInstances(first: number, count: number) {
    const end = Math.min(first + count, records.capacity)
    if (end <= first) return
    const at = words.byteOffset + first * INSTANCE_WORDS * 4
    records.write('Instance', first, end - first, words.buffer as ArrayBuffer, at)
  }
  /** The copies the records hold: every one, unless the cut refused their growth. */
  const copiesHeldOnGpu = () => Math.min(copies.length, records.capacity - slots)

  // The placements standing, and their world boxes for the probes' occupancy map (`proxyBoxes.ts`).
  const live = () => packed.live?.worlds ?? packed.worldSources.length
  const boxes = createProxyBoxes(packed, slots, live)

  /** Row `w` of the culling's world table was written: its box is made again at the next `worldBoxes`. */
  function worldWritten(w: number) {
    if (w < 0 || w >= slots) return
    boxes.mark(w)
  }

  const head = new Uint32Array(RUNTIME_HEADER_WORDS),
    headFloats = new Float32Array(head.buffer)
  /** The header, as it stands. */
  function header() {
    const at = RUNTIME_HEADER
    head[at.instances] = slots
    head[at.surfacesWord] = layout.surfaces
    head[at.trianglesWord] = layout.triangles
    head[at.copyWorldsWord] = layout.copyWorlds
    head[at.boundsWord] = layout.bounds
    head[at.childrenWord] = layout.children
    // The tree's top, its node 0 (`placementTree.ts`), read in its record table (`treeTable.ts`).
    head[at.treeRoot] = tree ? 0 : NO_INDEX
    head[at.members] = tree ? tree.count : packed.worldSources.length
    headFloats[at.error] = error
    head[at.copies] = copiesHeldOnGpu()
    return head
  }

  /** The buffer and the instances, made and written at the first need with everything the CPU holds written
   *  into them; the table made larger when the copies outgrow it. */
  function ensure() {
    records.hold(words.length / INSTANCE_WORDS)
    if (!instancesSent) writeInstances(0, words.length / INSTANCE_WORDS)
    instancesSent = true
    if (buffer) return buffer
    const bytes = byteAt(layout.total)
    // Made in the device's ledger, as every resource the engine allocates (`constructGpuResources`).
    const made = constructGpuResources(device, () =>
      device.createBuffer({
        label: LABEL,
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      }),
    )
    buffer = made
    send(made, 0, header())
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
    if (made) {
      const encoder = device.createCommandEncoder({ label: 'Trillion3D run-time proxy growth' })
      const copy = (from: number, to: number, count: number) =>
        count > 0 && encoder.copyBufferToBuffer(old, byteAt(from), made, byteAt(to), count * 4)
      copy(before.triangles, layout.triangles, triangles.extent * PROXY_TRIANGLE_FLOATS)
      copy(before.bounds, layout.bounds, nodes.extent * PROXY_NODE_FLOATS)
      copy(before.children, layout.children, nodes.extent * PROXY_NODE_WORDS)
      copy(before.deform, layout.deform, corners.extent)
      device.queue.submit([encoder.finish()])
    }
    // The old buffer may be recorded in commands of this image not yet submitted: retired, it is
    // destroyed after the frame's submit (`gpu/core/frameRetire.ts`), as every grown table's.
    retire(device, old)
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
  function surfaceSlot(surface: PageSurface, tint: number) {
    // The record as its owner last wrote it: its words written again when its version moved.
    let tints = surfaces.get(surface)
    if (!tints) surfaces.set(surface, (tints = new Map()))
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
      resolved.fill(NO_INDEX, at, at + INSTANCE_WORDS)
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
      boxes.mark(w)
      resolve(w)
      const at = w * INSTANCE_WORDS,
        parked = packed.rootNodes[w] === NO_INDEX
      words.set(resolved.subarray(at, at + INSTANCE_WORDS), at)
      if (parked) words[at + INSTANCE.node] = NO_INDEX
    }
    if (buffer || cuts.size) {
      const made = ensure()
      writeInstances(from, to - from)
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
      // A copy of a deforming mesh stands at its own posed copy, as a placement does.
      const posedAs =
        shown && cut.deform && placed.corner !== undefined
          ? posedCopy(slots + k, cut, placed)
          : undefined
      if (!posedAs) dropPosed(slots + k)
      moved =
        setWord(at + INSTANCE.node, shown ? (posedAs?.node ?? placed.node) : NO_INDEX) || moved
      moved =
        setWord(at + INSTANCE.triangle, shown ? (posedAs?.triangle ?? placed.triangle) : 0) || moved
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
    writeInstances(slots, copies.length)
    send(made, byteAt(layout.copyWorlds), copyWorlds)
  }

  write(0, live())

  /** The blended copies the forward family draws, members of this proxy after the placements: their
   *  poses are the host's (`BlendCopy.matrix`), read again at each cut. The host's list grows in place
   *  as a source joins: every cut counts it again (`refresh`) before it writes the copies. */
  function setCopies(next: readonly ProxyCopy[]) {
    if (next === copies && next.length === copiesHeld()) return
    if (next.length !== copiesHeld()) {
      const kept = words.subarray(0, slots * INSTANCE_WORDS)
      copies = next
      for (const w of [...posed.keys()]) if (w >= slots + next.length) dropPosed(w)
      words = new Uint32Array((slots + copies.length) * INSTANCE_WORDS).fill(NO_INDEX)
      words.set(kept)
      copyWorlds = new Float32Array(copies.length * WORLD_WORDS)
      relayout()
    } else copies = next
    syncCopies()
  }

  /** The copies the instance words and worlds are laid out for. */
  const copiesHeld = () => copyWorlds.length / WORLD_WORDS

  return {
    /** The buffer a program reads the proxy through, or none: it then reads the stand-ins. */
    buffer() {
      return buffer
    },
    /** The world box of each placement that wears a proxy, and which of them are new or moved since the last
     *  call: what the probes' occupancy map keeps (`bounce/probes.ts`). */
    worldBoxes: boxes.worldBoxes,
    /**
     * The deformed placements' copies posed, in `encoder`, before the first program of the image that traces
     * them: when the deformation's records moved (`host.revision`) or a copy is new, and once the pose's
     * program is built.
     */
    pose(encoder: GPUCommandEncoder, host: PoseHost) {
      if (!buffer || !posed.size || !host.pool) return
      if (host.revision === posedRevision && !poseFresh) return
      if (entriesLayout !== poseLayout) {
        entriesLayout = poseLayout
        poseEntries.length = poseKeys.length = 0
        for (const [w, copy] of posed) {
          poseKeys.push(w)
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
      for (let k = 0; k < poseEntries.length; k++) {
        // A placement's record is found by its root's world, a blended copy's by its matrix.
        const w = poseKeys[k],
          world = w < slots ? (packed.worldSources[w] as DagRoot).world : copies[w - slots]?.matrix
        poseEntries[k].record = world ? host.recordOf(world) : 0
      }
      if (!pose.run(encoder, buffer, host.pool, poseEntries, poseLayout)) return
      posedRevision = host.revision
      poseFresh = false
    },
    /** The meshes' proxies of a compiled scene arrived (`RootProxy.primitive.runtimeProxy` was set): every
     *  placement wears what its primitive holds now. */
    arrived() {
      write(0, live())
    },
    /** Rows `rows[0..count)` of the culling's world table were written (a pose, a park, a composition under a
     *  moved parent): their boxes are made again. */
    worldsWritten(rows: ArrayLike<number>, count = rows.length) {
      for (let k = 0; k < count; k++) worldWritten(rows[k])
    },
    /** Row `w` of it was written. */
    worldWritten,
    /** Rows `[from, to)` of it were written, appended roots' worlds among them. */
    worldsRange(from: number, to: number) {
      for (let w = from; w < to; w++) worldWritten(w)
    },
    /** Roots `[from, to)` were appended behind the others: their instances. */
    appended(from: number, to: number) {
      write(from, to)
    },
    /** The blended copies the forward family draws, members of this proxy after the placements: their
     *  poses are the host's (`BlendCopy.matrix`), read again at each cut. */
    setCopies,
    /** Placement `w` parked, or taken back. */
    park(w: number, parked: boolean) {
      if (w >= slots) return
      boxes.mark(w)
      if (!buffer) return
      const at = w * INSTANCE_WORDS,
        node = parked ? NO_INDEX : resolved[at + INSTANCE.node]
      if (words[at + INSTANCE.node] === node) return
      words[at + INSTANCE.node] = node
      writeInstances(w, 1)
    },
    /** Placement `w`'s frame word, its mark and the deformation's reach above it. */
    mark(w: number, mark: number) {
      if (!buffer || w >= slots) return
      const at = w * INSTANCE_WORDS + INSTANCE.mark,
        held = markOf(w, mark)
      resolved[at] = held
      if (words[at] === held) return
      words[at] = held
      writeInstances(w, 1)
    },
    /** The surfaces a host edited and the copies that moved since the last cut, written again. */
    refresh() {
      if (copies.length !== copiesHeld()) setCopies(copies)
      if (!buffer && !copies.length) return
      for (const [surface, tints] of surfaces)
        for (const tint of tints.keys()) surfaceSlot(surface, tint)
      syncCopies()
      if (buffer && dirty) {
        send(buffer, 0, header())
        dirty = false
      }
    },
    /** Bytes the CPU keeps for the proxy: the instance words as written and as resolved, the surface and copy
     *  words and the world boxes (the cuts' columns are the primitives', counted with the scene proxy's cache
     *  object). What the streamer's reservation counts. */
    get hostBytes() {
      return (
        words.byteLength +
        resolved.byteLength +
        surfaceWords.byteLength +
        copyWorlds.byteLength +
        boxes.hostBytes
      )
    },
    /** Bytes of the buffer: what the cut's memory budget counts; the instances are the records',
     *  the cut's own. */
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
