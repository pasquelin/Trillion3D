/**
 * THE RUN-TIME PROXY KEPT TO THE PLACEMENTS IT TRACES: what a ray can meet of the meshes the world cut
 * at run time, beyond the visible cut (`bounce/runtimeTraceWgsl.ts`). One buffer
 * (`bounce/runtimeLayout.ts`) holds an instance of four words per placement — written next to the
 * culling's own rows, the same `w` —, a surface per drawn material and the arena of the cuts'
 * proxies, each uploaded once, when a placement first wears it. The placements' worlds, and the tree
 * above them, are the culling's: the buffers are the cut's, read where they lie (`buffers`).
 *
 * A member of the run (`runtime.ts`): its operations tell it what moved — roots appended, a
 * placement parked or marked — and each cut refreshes the surfaces a host edited since. A surface
 * edited while no cut is encoded waits for the next one. Without a placement that wears a proxy, no
 * buffer is made and `buffers` answers none: the trace reads its empty stand-ins.
 */
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/index.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { refreshSurface, type PageSurface } from '../../page/surface.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { createSpans } from '../../bounce/runtimeArena.ts'
import {
  INSTANCE,
  INSTANCE_WORDS,
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  RUNTIME_NONE,
  RUNTIME_TRACE_STORAGE_BUFFERS,
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

/** Where a cut lies in the arena: its first node and triangle, and what it holds. */
type Placed = { node: number; triangle: number; nodes: number; triangles: number }

export function createProxyInstances({ device, packed, nodeParts, coldParts, frames }: Resources) {
  const tree = packed.placementTree
  // One part of each table the trace binds: a split table (a device whose one binding is small, or
  // an enormous scene) is not read, and the chain goes on without this stage.
  const holds =
    (device.limits?.maxStorageBuffersPerShaderStage ?? 8) >= RUNTIME_TRACE_STORAGE_BUFFERS &&
    nodeParts.buffers.length === 1 &&
    coldParts.buffers.length === 1 &&
    (!tree || (tree.cellBase + treeNodeCount(tree)) * DAG_NODE_FLOATS * 4 <= nodeParts.bytes)
  const slots = Math.max(1, packed.worldCount)
  const words = new Uint32Array(slots * INSTANCE_WORDS).fill(RUNTIME_NONE)
  // The instance a placement wears now, and the one it keeps while parked.
  const resolved = new Uint32Array(slots * INSTANCE_WORDS).fill(RUNTIME_NONE)
  const cuts = new Map<RuntimeCutProxy, Placed>(),
    surfaces = new Map<PageSurface, { slot: number; version: number; at: number }>()
  const triangles = createSpans(START.triangles),
    nodes = createSpans(START.nodes)
  let surfaceCapacity = START.surfaces,
    error = 0,
    buffer: GPUBuffer | undefined,
    layout = layoutOf(slots, surfaceCapacity, triangles.capacity, nodes.capacity),
    surfaceWords = new Uint32Array(surfaceCapacity * SURFACE_WORDS),
    dirty = true

  function layoutOf(placements: number, surfaceCap: number, triangleCap: number, nodeCap: number) {
    const instances = 0,
      surfacesAt = instances + placements * INSTANCE_WORDS,
      trianglesAt = surfacesAt + surfaceCap * SURFACE_WORDS,
      boundsAt = trianglesAt + triangleCap * PROXY_TRIANGLE_FLOATS,
      childrenAt = boundsAt + nodeCap * PROXY_NODE_FLOATS
    return {
      instances,
      surfaces: surfacesAt,
      triangles: trianglesAt,
      bounds: boundsAt,
      children: childrenAt,
      total: childrenAt + nodeCap * PROXY_NODE_WORDS,
    }
  }
  const byteAt = (word: number) => (RUNTIME_HEADER_WORDS + word) * 4

  /** The header, as it stands. */
  function header() {
    const head = new Uint32Array(RUNTIME_HEADER_WORDS)
    const at = RUNTIME_HEADER
    head[at.instances] = slots
    head[at.instancesWord] = layout.instances
    head[at.surfacesWord] = layout.surfaces
    head[at.trianglesWord] = layout.triangles
    head[at.boundsWord] = layout.bounds
    head[at.childrenWord] = layout.children
    head[at.treeRoot] = tree ? tree.levels[0].base : RUNTIME_NONE
    head[at.membersWord] = tree?.members ?? 0
    head[at.members] = tree ? tree.count : packed.worldSources.length
    head[at.worldStride] = WORLD_WORDS
    head[at.worldRows] = frames.ranges[0]?.count ?? 0
    new Float32Array(head.buffer)[at.error] = error
    return head
  }

  /** The buffer, made at the first need and again, copied, where a table outgrew it. */
  function ensure() {
    if (buffer) return buffer
    buffer = device.createBuffer({
      label: 'Trillion3D run-time proxy',
      size: byteAt(layout.total),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    device.queue.writeBuffer(buffer, 0, header())
    device.queue.writeBuffer(buffer, byteAt(layout.instances), words)
    device.queue.writeBuffer(buffer, byteAt(layout.surfaces), surfaceWords)
    return buffer
  }

  /** The tables laid out for `want` more: the buffer replaced by a larger one holding what the old
   *  one did, where any table is full. */
  function grow(want: { triangles: number; nodes: number; surfaces: number }) {
    const next = layoutOf(
      slots,
      Math.max(surfaceCapacity, want.surfaces),
      triangles.grown(want.triangles),
      nodes.grown(want.nodes),
    )
    if (next.total === layout.total && next.surfaces === layout.surfaces) return
    const old = buffer,
      before = layout
    surfaceCapacity = Math.max(surfaceCapacity, want.surfaces)
    layout = next
    const grownSurfaces = new Uint32Array(surfaceCapacity * SURFACE_WORDS)
    grownSurfaces.set(surfaceWords)
    surfaceWords = grownSurfaces
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
      grow({
        triangles: triangles.extent + triangleCount,
        nodes: nodes.extent + nodeCount,
        surfaces: 0,
      })
      triangle = triangles.take(triangleCount)
      node = nodes.take(nodeCount)
    }
    if (triangle === undefined || node === undefined) return undefined
    const made = ensure()
    device.queue.writeBuffer(
      made,
      byteAt(layout.triangles + triangle * PROXY_TRIANGLE_FLOATS),
      cut.triangles,
    )
    device.queue.writeBuffer(made, byteAt(layout.bounds + node * PROXY_NODE_FLOATS), cut.nodeBounds)
    device.queue.writeBuffer(
      made,
      byteAt(layout.children + node * PROXY_NODE_WORDS),
      cut.nodeChildren,
    )
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
        grow({ triangles: 0, nodes: 0, surfaces: surfaceCapacity * 2 })
      held = { slot: surfaces.size, version: NaN, at: surfaces.size * SURFACE_WORDS }
      surfaces.set(host, held)
    }
    if (held.version !== surface.version || !Number.isFinite(held.version)) {
      held.version = surface.version
      writeSurface(surfaceWords, held.at, surface)
      if (buffer)
        device.queue.writeBuffer(
          buffer,
          byteAt(layout.surfaces + held.at),
          surfaceWords,
          held.at,
          SURFACE_WORDS,
        )
    }
    return held.slot
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
    // The proxy's error at the placement's scale: the distance a ray leaves a surface off its normal.
    const m = packed.worlds,
      scale = Math.max(
        length3(m[w * 16], m[w * 16 + 1], m[w * 16 + 2]),
        length3(m[w * 16 + 4], m[w * 16 + 5], m[w * 16 + 6]),
        length3(m[w * 16 + 8], m[w * 16 + 9], m[w * 16 + 10]),
      )
    const world = proxy.cut.cellMetres * 0.866 * scale
    if (world > error) {
      error = world
      dirty = true
    }
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
    if (buffer || [...cuts.keys()].length) {
      const made = ensure()
      device.queue.writeBuffer(
        made,
        byteAt(layout.instances + from * INSTANCE_WORDS),
        words,
        from * INSTANCE_WORDS,
        (to - from) * INSTANCE_WORDS,
      )
      device.queue.writeBuffer(made, 0, header())
      dirty = false
    }
  }

  const live = () => packed.live?.worlds ?? packed.worldSources.length
  if (holds) write(0, live())

  return {
    /** The buffers the trace reads, or none: this stage then reads the stand-ins. */
    buffers() {
      if (!holds || !buffer) return undefined
      return {
        proxy: buffer,
        nodes: nodeParts.buffers[0],
        cold: coldParts.buffers[0],
        worlds: frames.worldBuffers[0],
      }
    },
    /** Roots `[from, to)` were appended behind the others: their instances, and the tree's members. */
    appended(from: number, to: number) {
      if (holds) write(from, to)
    },
    /** Placement `w` parked, or taken back. */
    park(w: number, parked: boolean) {
      if (!holds || !buffer || w >= slots) return
      const at = w * INSTANCE_WORDS,
        node = parked ? RUNTIME_NONE : resolved[at + INSTANCE.node]
      if (words[at + INSTANCE.node] === node) return
      words[at + INSTANCE.node] = node
      device.queue.writeBuffer(
        buffer,
        byteAt(layout.instances + at + INSTANCE.node),
        words,
        at + INSTANCE.node,
        1,
      )
    },
    /** Placement `w`'s frame word, its mark and the deformation's reach above it. */
    mark(w: number, mark: number) {
      if (!holds || !buffer || w >= slots) return
      const at = w * INSTANCE_WORDS + INSTANCE.mark
      resolved[at] = mark
      if (words[at] === mark) return
      words[at] = mark
      device.queue.writeBuffer(buffer, byteAt(layout.instances + at), words, at, 1)
    },
    /** The surfaces a host edited since the last cut, written again. */
    refresh() {
      if (!holds || !buffer) return
      for (const [surface] of surfaces) surfaceSlot(surface)
      if (dirty) {
        device.queue.writeBuffer(buffer, 0, header())
        dirty = false
      }
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
