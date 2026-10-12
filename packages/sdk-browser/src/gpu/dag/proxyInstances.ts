/**
 * THE RUN-TIME PROXY KEPT TO THE PLACEMENTS IT TRACES: what a ray can meet of the meshes the world cut
 * at run time, beyond the visible cut (`bounce/runtimeTraceWgsl.ts`). One buffer
 * (`bounce/runtimeLayout.ts`) holds an instance of four words a placement — written next to the
 * culling's own rows, the same `w` —, one for each blended copy the forward family draws (the
 * members after the placements, their worlds in the buffer: they are no member of the culling's
 * tree), a surface a drawn material and the arena of the cuts' proxies, each uploaded once, when a
 * placement or a copy first wears it. The placements' worlds, and the tree above them, are the
 * culling's: the buffers are the cut's, read where they lie (`buffers`) — the part of a split table
 * that holds the tree, a tree no part holds whole walked as the placements it orders.
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
import { length3 } from '../../../../math/src/vector/vector.ts'
import { refreshSurface, type PageSurface } from '../../page/surface.ts'
import type { RootProxy } from '../../page/selection/types.ts'
import { rowParked, type PlacementOf } from '../../placement/rows.ts'
import { createSpans } from '../../bounce/runtimeArena.ts'
import {
  INSTANCE,
  INSTANCE_WORDS,
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  RUNTIME_NONE,
  SURFACE_WORDS,
} from '../../bounce/runtimeLayout.ts'
import { writeSurface } from '../../bounce/runtimeSurface.ts'
import type { DagParts } from './split.ts'
import { treeNodeCount } from './placementTree.ts'
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './types.ts'

/** The world matrices are sixteen words each in the cut's worlds, the exact translations behind. */
const WORLD_WORDS = 16
/** Cuts, surfaces, triangles and nodes a first buffer is laid out for: doubled as needed. */
const START = { surfaces: 16, triangles: 4096, nodes: 1024 }

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

/** Where a cut lies in the arena: its first node and triangle, and what it holds. */
type Placed = { node: number; triangle: number; nodes: number; triangles: number }

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
  const nodesFirst = walksTree ? nodePart * (nodeParts.bytes / (DAG_NODE_FLOATS * 4)) : 0,
    coldFirst = walksTree ? coldPart * (coldParts.bytes / 4) : 0
  let words = new Uint32Array(slots * INSTANCE_WORDS).fill(RUNTIME_NONE)
  // The instance a placement wears now, and the one it keeps while parked.
  const resolved = new Uint32Array(slots * INSTANCE_WORDS).fill(RUNTIME_NONE)
  const cuts = new Map<RuntimeCutProxy, Placed>(),
    surfaces = new Map<PageSurface, { slot: number; version: number; at: number }>()
  const triangles = createSpans(START.triangles),
    nodes = createSpans(START.nodes)
  let copies: readonly ProxyCopy[] = [],
    copyCount = 0,
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
      copyWorldsAt = instances + (slots + copies.length) * INSTANCE_WORDS,
      surfacesAt = copyWorldsAt + copies.length * WORLD_WORDS,
      trianglesAt = surfacesAt + surfaceCapacity * SURFACE_WORDS,
      boundsAt = trianglesAt + triangles.capacity * PROXY_TRIANGLE_FLOATS,
      childrenAt = boundsAt + nodes.capacity * PROXY_NODE_FLOATS
    return {
      instances,
      copyWorlds: copyWorldsAt,
      surfaces: surfacesAt,
      triangles: trianglesAt,
      bounds: boundsAt,
      children: childrenAt,
      total: childrenAt + nodes.capacity * PROXY_NODE_WORDS,
    }
  }
  const byteAt = (word: number) => (RUNTIME_HEADER_WORDS + word) * 4
  /** Every write to the buffer: what a ray can meet changed, so its answers are of another epoch. */
  const send: GPUQueue['writeBuffer'] = (...args) => {
    revision++
    device.queue.writeBuffer(...args)
  }

  /** The header, as it stands. */
  function header() {
    const head = new Uint32Array(RUNTIME_HEADER_WORDS)
    const at = RUNTIME_HEADER
    head[at.instances] = slots
    head[at.instancesWord] = layout.instances
    head[at.surfacesWord] = layout.surfaces
    head[at.trianglesWord] = layout.triangles
    head[at.copyWorldsWord] = layout.copyWorlds
    head[at.boundsWord] = layout.bounds
    head[at.childrenWord] = layout.children
    head[at.treeRoot] = walksTree ? tree!.levels[0].base : RUNTIME_NONE
    head[at.membersWord] = walksTree ? tree!.members : 0
    head[at.members] = walksTree ? tree!.count : packed.worldSources.length
    head[at.worldStride] = WORLD_WORDS
    head[at.worldRows] = frames.ranges[0]?.count ?? 0
    new Float32Array(head.buffer)[at.error] = error
    head[at.nodeFirst] = nodesFirst
    head[at.coldFirst] = coldFirst
    head[at.copies] = copies.length
    return head
  }

  /** The buffer, made at the first need with everything the CPU holds written into it. */
  function ensure() {
    if (buffer) return buffer
    buffer = device.createBuffer({
      label: 'Trillion3D run-time proxy',
      size: byteAt(layout.total),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    send(buffer, 0, header())
    send(buffer, byteAt(layout.instances), words)
    if (copyWorlds.length) send(buffer, byteAt(layout.copyWorlds), copyWorlds)
    send(buffer, byteAt(layout.surfaces), surfaceWords)
    return buffer
  }

  /** The tables laid out again — `want` more triangles, nodes, surfaces, or a copy more or fewer —:
   *  the buffer replaced by one the new layout fits, the columns it held carried over by copies. */
  function relayout(want = { triangles: 0, nodes: 0, surfaces: 0 }) {
    triangles.grown(want.triangles)
    nodes.grown(want.nodes)
    const before = layout,
      grownSurfaces = Math.max(surfaceCapacity, want.surfaces)
    if (grownSurfaces !== surfaceCapacity) {
      surfaceCapacity = grownSurfaces
      const next = new Uint32Array(surfaceCapacity * SURFACE_WORDS)
      next.set(surfaceWords)
      surfaceWords = next
    }
    layout = layoutOf()
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
    device.queue.submit([encoder.finish()])
    old.destroy()
  }

  /** A cut's columns in the arena, uploaded the first time a placement wears it. */
  function place(cut: RuntimeCutProxy): Placed | undefined {
    const known = cuts.get(cut)
    if (known) return known
    const triangleCount = cut.triangles.length / PROXY_TRIANGLE_FLOATS,
      nodeCount = cut.nodeBounds.length / PROXY_NODE_FLOATS
    if (!triangleCount || !nodeCount) return undefined
    let triangle = triangles.take(triangleCount),
      node = nodes.take(nodeCount)
    if (triangle === undefined || node === undefined) {
      if (triangle !== undefined) triangles.release(triangle, triangleCount)
      if (node !== undefined) nodes.release(node, nodeCount)
      relayout({
        triangles: triangles.extent + triangleCount,
        nodes: nodes.extent + nodeCount,
        surfaces: 0,
      })
      triangle = triangles.take(triangleCount)
      node = nodes.take(nodeCount)
    }
    if (triangle === undefined || node === undefined) return undefined
    const made = ensure()
    send(made, byteAt(layout.triangles + triangle * PROXY_TRIANGLE_FLOATS), cut.triangles)
    send(made, byteAt(layout.bounds + node * PROXY_NODE_FLOATS), cut.nodeBounds)
    send(made, byteAt(layout.children + node * PROXY_NODE_WORDS), cut.nodeChildren)
    const placed = { node, triangle, nodes: nodeCount, triangles: triangleCount }
    cuts.set(cut, placed)
    return placed
  }

  /** A surface's slot, its words written the first time and each time its record moved on. */
  function surfaceSlot(host: PageSurface) {
    // The record the host last wrote: read again when its version moved.
    const surface = refreshSurface(host)
    let held = surfaces.get(host)
    if (!held) {
      if (surfaces.size === surfaceCapacity)
        relayout({ triangles: 0, nodes: 0, surfaces: surfaceCapacity * 2 })
      held = { slot: surfaces.size, version: NaN, at: surfaces.size * SURFACE_WORDS }
      surfaces.set(host, held)
    }
    if (held.version !== surface.version || !Number.isFinite(held.version)) {
      held.version = surface.version
      writeSurface(surfaceWords, held.at, surface)
      if (buffer)
        send(buffer, byteAt(layout.surfaces + held.at), surfaceWords, held.at, SURFACE_WORDS)
    }
    return held.slot
  }

  /** The error of a proxy at a pose: the distance a ray leaves a surface off its normal. */
  function noteError(cell: number, m: ArrayLike<number>, at: number) {
    const scale = Math.max(
      length3(m[at], m[at + 1], m[at + 2]),
      length3(m[at + 4], m[at + 5], m[at + 6]),
      length3(m[at + 8], m[at + 9], m[at + 10]),
    )
    const world = cell * 0.866 * scale
    if (world > error) {
      error = world
      dirty = true
    }
  }

  /** The instance words of placement `w`, from the root it holds, parked or not. */
  function resolve(w: number) {
    const root = packed.worldSources[w] as DagRoot | undefined,
      at = w * INSTANCE_WORDS
    const proxy = root?.proxy
    const placed = proxy && place(proxy.cut)
    if (!proxy || !placed) {
      resolved.fill(RUNTIME_NONE, at, at + INSTANCE_WORDS)
      resolved[at + INSTANCE.mark] = 0
      return
    }
    resolved[at + INSTANCE.node] = placed.node
    resolved[at + INSTANCE.triangle] = placed.triangle
    resolved[at + INSTANCE.surface] = surfaceSlot(proxy.surface)
    resolved[at + INSTANCE.mark] = packed.mark[w] ?? 0
    noteError(proxy.cut.cellMetres, packed.worlds, w * 16)
  }

  /** Placements `[from, to)` written: what they wear, parked ones none until they are taken back. */
  function write(from: number, to: number) {
    for (let w = from; w < to; w++) {
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

  /** The copies' instances and poses, as the host holds them now: written where one moved, was shown or
   *  hidden, or wears another cut. */
  function syncCopies() {
    let moved = false
    copies.forEach((copy, k) => {
      const at = (slots + k) * INSTANCE_WORDS,
        proxy = copy.proxy
      const placed = proxy && place(proxy.cut)
      const shown = !!placed && !copy.hidden && !rowParked(copy.placement)
      const next = shown
        ? [placed.node, placed.triangle, surfaceSlot(proxy.surface), 0]
        : [RUNTIME_NONE, 0, 0, 0]
      for (let j = 0; j < INSTANCE_WORDS; j++)
        if (words[at + j] !== next[j]) {
          words[at + j] = next[j]
          moved = true
        }
      if (!shown) return
      const world = copy.matrix.elements
      for (let j = 0; j < WORLD_WORDS; j++)
        if (copyWorlds[k * WORLD_WORDS + j] !== Math.fround(world[j])) {
          copyWorlds[k * WORLD_WORDS + j] = world[j]
          moved = true
        }
      noteError(proxy.cut.cellMetres, world, 0)
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

  return {
    /** The buffers the trace reads, or none: this stage then reads the stand-ins. */
    buffers() {
      if (!buffer) return undefined
      return {
        proxy: buffer,
        nodes: nodeParts.buffers[nodePart ?? 0],
        cold: coldParts.buffers[coldPart ?? 0],
        worlds: frames.worldBuffers[0],
      }
    },
    /** Roots `[from, to)` were appended behind the others: their instances, and the tree's members. */
    appended: write,
    /** The blended copies the forward family draws, members of this proxy after the placements: their
     *  poses are the host's (`BlendCopy.matrix`), read again at each cut. */
    setCopies(next: readonly ProxyCopy[]) {
      if (next === copies && next.length === copyCount) return
      if (next.length !== copyCount) {
        const kept = words.subarray(0, slots * INSTANCE_WORDS)
        copies = next
        words = new Uint32Array((slots + copies.length) * INSTANCE_WORDS).fill(RUNTIME_NONE)
        words.set(kept)
        copyWorlds = new Float32Array(copies.length * WORLD_WORDS)
        copyCount = copies.length
        relayout()
      } else copies = next
      syncCopies()
    },
    /** Placement `w` parked, or taken back. */
    park(w: number, parked: boolean) {
      if (!buffer || w >= slots) return
      const at = w * INSTANCE_WORDS,
        node = parked ? RUNTIME_NONE : resolved[at + INSTANCE.node]
      if (words[at + INSTANCE.node] === node) return
      words[at + INSTANCE.node] = node
      send(buffer, byteAt(layout.instances + at + INSTANCE.node), words, at + INSTANCE.node, 1)
    },
    /** Placement `w`'s frame word, its mark and the deformation's reach above it. */
    mark(w: number, mark: number) {
      if (!buffer || w >= slots) return
      const at = w * INSTANCE_WORDS + INSTANCE.mark
      resolved[at] = mark
      if (words[at] === mark) return
      words[at] = mark
      send(buffer, byteAt(layout.instances + at), words, at, 1)
    },
    /** The surfaces a host edited and the copies that moved since the last cut, written again. */
    refresh() {
      if (!buffer && !copies.length) return
      for (const [surface] of surfaces) surfaceSlot(surface)
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
    /** Bytes of the buffer: what the cut's memory budget counts. */
    get bytes() {
      return buffer?.size ?? 0
    },
    dispose() {
      buffer?.destroy()
      buffer = undefined
    },
  }
}
export type ProxyInstances = ReturnType<typeof createProxyInstances>
