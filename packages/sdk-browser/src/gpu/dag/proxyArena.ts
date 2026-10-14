/**
 * THE PROXY'S ARENA (`proxyInstances.ts`): one buffer (`bounce/runtimeLayout.ts`) that holds, past
 * its header, the blended copies' worlds, a surface a drawn material and the arena of the meshes'
 * proxies — triangles, bounds, children, deformation corners —, bounded by the meshes, not by the
 * placements. The meshes' columns take their spans in it (`proxyColumns.ts`); a surface's words go
 * up each time its record moves on (`surfaceSlot`). A table full lays the buffer out again
 * (`relayout`): a new one made, the columns carried over on the GPU, the old one retired.
 */
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { constructGpuResources } from '../core/errorScope.ts'
import type { PageSurface } from '../../page/surface.ts'
import { createSpans } from '../../bounce/spans.ts'
import { retire } from '../core/frameRetire.ts'
import {
  RUNTIME_HEADER_WORDS,
  RUNTIME_WORLD_WORDS,
  SURFACE_WORDS,
} from '../../bounce/runtimeLayout.ts'
import { writeSurface } from '../../bounce/runtimeSurface.ts'

/** Surfaces, triangles, nodes and corners a first buffer is laid out for: doubled as needed. */
const START = { surfaces: 16, triangles: 4096, nodes: 1024, corners: 4096 }
const LABEL = 'Trillion3D run-time proxy'

/** A write's arguments past the buffer it lands in (`GPUQueue.writeBuffer`). */
type WriteArgs =
  Parameters<GPUQueue['writeBuffer']> extends [GPUBuffer, ...infer Rest] ? Rest : never

/** A surface slot: the words it holds are those of a version of its record, under a tint. */
type Held = { slot: number; version: number; at: number }

/** What the arena asks of the proxy that owns it: its instances on the GPU before the buffer is
 *  made (`ready`), and the header and the copies' worlds a buffer made is written with. */
type ArenaOwner = {
  ready(): void
  header(): Uint32Array<ArrayBuffer>
  copyWorlds(): Float32Array<ArrayBuffer>
}

export function createProxyArena(device: GPUDevice, owner: ArenaOwner) {
  const surfaces = new Map<PageSurface, Map<number, Held>>()
  const triangles = createSpans(START.triangles),
    nodes = createSpans(START.nodes),
    corners = createSpans(START.corners)
  let surfaceCount = 0,
    surfaceCapacity = START.surfaces,
    surfaceWords = new Uint32Array(surfaceCapacity * SURFACE_WORDS),
    copies = 0,
    buffer: GPUBuffer | undefined,
    revision = 0,
    layout = layoutOf()

  function layoutOf() {
    const surfacesAt = copies * RUNTIME_WORLD_WORDS,
      trianglesAt = surfacesAt + surfaceCapacity * SURFACE_WORDS,
      boundsAt = trianglesAt + triangles.capacity * PROXY_TRIANGLE_FLOATS,
      childrenAt = boundsAt + nodes.capacity * PROXY_NODE_FLOATS,
      deformAt = childrenAt + nodes.capacity * PROXY_NODE_WORDS
    return {
      copyWorlds: 0,
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

  /** The buffer, made at the first need with everything the CPU holds written into it, the
   *  instances on the GPU first. */
  function made() {
    owner.ready()
    if (buffer) return buffer
    // Made in the device's ledger, as every resource the engine allocates (`constructGpuResources`).
    const next = constructGpuResources(device, () =>
      device.createBuffer({
        label: LABEL,
        size: byteAt(layout.total),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      }),
    )
    buffer = next
    send(next, 0, owner.header())
    const worlds = owner.copyWorlds()
    if (worlds.length) send(next, byteAt(layout.copyWorlds), worlds)
    send(next, byteAt(layout.surfaces), surfaceWords, 0, surfaceCapacity * SURFACE_WORDS)
    return next
  }

  /** The tables laid out again — `want` more triangles, nodes, surfaces, corners, or `copies`
   *  copies —: the buffer replaced by one the new layout fits, the columns it held carried over. */
  function relayout(
    want: {
      triangles?: number
      nodes?: number
      surfaces?: number
      corners?: number
      copies?: number
    } = {},
  ) {
    triangles.grown(want.triangles ?? 0)
    nodes.grown(want.nodes ?? 0)
    corners.grown(want.corners ?? 0)
    const before = layout
    surfaceCapacity = Math.max(surfaceCapacity, want.surfaces ?? 0)
    surfaceWords = resized(surfaceWords, surfaceCapacity * SURFACE_WORDS)
    copies = want.copies ?? copies
    layout = layoutOf()
    revision++
    const old = buffer
    buffer = undefined
    if (!old) return
    const next = made()
    const encoder = device.createCommandEncoder({ label: 'Trillion3D run-time proxy growth' })
    const copy = (from: number, to: number, count: number) =>
      count > 0 && encoder.copyBufferToBuffer(old, byteAt(from), next, byteAt(to), count * 4)
    copy(before.triangles, layout.triangles, triangles.extent * PROXY_TRIANGLE_FLOATS)
    copy(before.bounds, layout.bounds, nodes.extent * PROXY_NODE_FLOATS)
    copy(before.children, layout.children, nodes.extent * PROXY_NODE_WORDS)
    copy(before.deform, layout.deform, corners.extent)
    device.queue.submit([encoder.finish()])
    // The old buffer may be recorded in commands of this image not yet submitted: retired, it is
    // destroyed after the frame's submit (`gpu/core/frameRetire.ts`), as every grown table's.
    retire(device, old)
  }

  /** A surface's slot under a tint (`NO_TINT`: its own), its words written the first time and each
   *  time its record moved on. */
  function surfaceSlot(surface: PageSurface, tint: number) {
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
      send(buffer, byteAt(layout.surfaces + held.at), surfaceWords, held.at, SURFACE_WORDS)
    }
    return held.slot
  }

  return {
    /** The buffer as it stands, none before the first need. */
    get buffer() {
      return buffer
    },
    get layout() {
      return layout
    },
    /** Moves at each layout: where the columns lie changed. */
    get revision() {
      return revision
    },
    /** The spans the meshes' columns take (`proxyColumns.ts`). */
    spans: { triangles, nodes, corners },
    byteAt,
    send,
    made,
    relayout,
    surfaceSlot,
    /** Every surface held, its words written again where its record moved on. */
    refreshSurfaces() {
      for (const [surface, tints] of surfaces)
        for (const tint of tints.keys()) surfaceSlot(surface, tint)
    },
    get hostBytes() {
      return surfaceWords.byteLength
    },
    dispose() {
      buffer?.destroy()
      buffer = undefined
    },
  }
}
export type ProxyArena = ReturnType<typeof createProxyArena>
