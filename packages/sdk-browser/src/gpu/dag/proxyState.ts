/**
 * WHAT THE PROXY HOLDS OF ITS PLACEMENTS (`proxyInstances.ts`): their instance words — as written,
 * and as resolved, which a parked placement keeps —, the `Instance` field of the culling's records
 * they go up to, the header, the arena their meshes lie in (`proxyArena.ts`), their posed copies
 * (`proxyPosed.ts`) and their world boxes (`proxyBoxes.ts`).
 */
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { SQRT3, NO_INDEX } from '../../../../math/src/constants.ts'
import { longestColumn } from '../../../../math/src/matrix/matrixElements.ts'
import { createProxyBoxes } from './proxyBoxes.ts'
import { createProxyArena } from './proxyArena.ts'
import { createProxyColumns } from './proxyColumns.ts'
import { createPosedCopies } from './proxyPosed.ts'
import {
  INSTANCE,
  INSTANCE_WORDS,
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
} from '../../bounce/runtimeLayout.ts'
import { NO_TINT } from '../../bounce/runtimeSurface.ts'
import type { RecordTexture } from '../core/recordTexture.ts'
import type { DagRoot, PackedDag } from './types.ts'
import type { ProxyCopy } from './proxyInstances.ts'

/** A proxy's cell to the distance a ray leaves a surface by: half the cell's diagonal, the codec's
 *  `CELL_ERROR_FACTOR` (`page-codec-wasm/src/proxy/simplify.rs`). */
const CELL_ERROR_FACTOR = SQRT3 / 2

/** What a proxy is made from: the device, the packing and the culling's records. */
export type ProxySource = {
  device: GPUDevice
  packed: PackedDag
  /** The culling's records, whose `Instance` field the instances are (`worldTable.ts`). */
  frames: { worlds: RecordTexture }
}

/** The tint a mesh's proxy brings: the compiler's colour of its material, `NO_TINT` for a cut's
 *  white. */
export const tintOf = (cut: RuntimeCutProxy) => (cut.albedo.length ? cut.albedo[0] : NO_TINT)

export function createProxyState({ device, packed, frames }: ProxySource) {
  const tree = packed.placementTree
  const slots = Math.max(1, packed.worldCount)
  // The instance a placement wears now, as written, and the one it keeps while parked.
  const held = {
    words: new Uint32Array(slots * INSTANCE_WORDS).fill(NO_INDEX),
    resolved: new Uint32Array(slots * INSTANCE_WORDS).fill(NO_INDEX),
    copies: [] as readonly ProxyCopy[],
    copyWorlds: new Float32Array(0),
    error: 0,
    dirty: true,
  }
  // The instances, the `Instance` field of the culling's records (`worldTable.ts`): written whole
  // with the buffer, then the runs that moved; the table grown when the copies outgrow it, at the
  // cut's prepare alone (`holdRecords`).
  const records = frames.worlds
  let instancesSent = false
  /** The instances `[first, first + count)` the records hold, to them. */
  function writeInstances(first: number, count: number) {
    const end = Math.min(first + count, records.capacity),
      { words } = held
    if (end <= first) return
    const at = words.byteOffset + first * INSTANCE_WORDS * 4
    records.write('Instance', first, end - first, words.buffer as ArrayBuffer, at)
    arena.wrote()
  }
  /**
   * The records grown to hold every copy's instance, at the cut's prepare (`refresh`, before the
   * cut encodes): never mid-frame, so the growth's copy, submitted at once (`grownByCopy`), lands
   * before any GPU write of the frame's encoder to the table. The instances the table could not hold
   * before go up then; whether it grew, the header's copy count with it.
   */
  function holdRecords() {
    const before = records.capacity,
      wanted = held.words.length / INSTANCE_WORDS
    if (wanted <= before || !records.hold(wanted)) return false
    if (instancesSent) writeInstances(before, wanted - before)
    return true
  }
  /** The copies the records hold: every one, unless the cut refused their growth. */
  const copiesHeldOnGpu = () => Math.min(held.copies.length, records.capacity - slots)

  const head = new Uint32Array(RUNTIME_HEADER_WORDS),
    headFloats = new Float32Array(head.buffer)
  /** The header, as it stands. */
  function header() {
    const at = RUNTIME_HEADER,
      { layout } = arena
    head[at.instances] = slots
    head[at.surfacesWord] = layout.surfaces
    head[at.trianglesWord] = layout.triangles
    head[at.copyWorldsWord] = layout.copyWorlds
    head[at.boundsWord] = layout.bounds
    head[at.childrenWord] = layout.children
    // The tree's top, its node 0 (`placementTree.ts`), read in its record table (`treeTable.ts`).
    head[at.treeRoot] = tree ? 0 : NO_INDEX
    head[at.members] = tree ? tree.count : packed.worldSources.length
    headFloats[at.error] = held.error
    head[at.copies] = copiesHeldOnGpu()
    return head
  }

  // The buffer, made at the first need with the instances the table holds on the GPU first.
  const arena = createProxyArena(device, {
    ready() {
      if (!instancesSent) writeInstances(0, held.words.length / INSTANCE_WORDS)
      instancesSent = true
    },
    header,
    copyWorlds: () => held.copyWorlds,
  })
  const columns = createProxyColumns(arena)
  const posed = createPosedCopies(device, arena, columns, packed, slots, () => held.copies)

  // The placements standing, and their world boxes for the probes' occupancy map (`proxyBoxes.ts`).
  const live = () => packed.live?.worlds ?? packed.worldSources.length
  const boxes = createProxyBoxes(packed, slots, live)

  /** The error of a proxy at a pose: the distance a ray leaves a surface off its normal. */
  function noteError(cell: number, m: ArrayLike<number>, at: number) {
    const world = cell * CELL_ERROR_FACTOR * longestColumn(m, at)
    if (world > held.error) {
      held.error = world
      held.dirty = true
    }
  }

  /** A placement's mark as its instance holds it: a posed one is traced where the deformation put
   *  it, so the reach the mark carries above its flags, which tells how far its rest shape can be
   *  from there, goes. */
  const markOf = (w: number, mark: number) => (posed.has(w) ? mark & 0xffff : mark)

  /** The instance words of placement `w`, from the root it holds, parked or not. */
  function resolve(w: number) {
    const root = packed.worldSources[w] as DagRoot | undefined,
      at = w * INSTANCE_WORDS,
      { resolved } = held
    const proxy = root?.proxy
    const cut = proxy?.primitive.runtimeProxy
    const placed = cut && columns.place(cut)
    if (!proxy || !cut || !placed) {
      resolved.fill(NO_INDEX, at, at + INSTANCE_WORDS)
      resolved[at + INSTANCE.mark] = 0
      return
    }
    // A placement whose mesh deforms stands at its own copy, which the pose moves; the others
    // share the mesh's.
    const copy = cut.deform && placed.corner !== undefined ? posed.take(w, cut, placed) : undefined
    if (!copy) posed.drop(w)
    resolved[at + INSTANCE.node] = copy?.node ?? placed.node
    resolved[at + INSTANCE.triangle] = copy?.triangle ?? placed.triangle
    resolved[at + INSTANCE.surface] = arena.surfaceSlot(proxy.surface, tintOf(cut))
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
      held.words.set(held.resolved.subarray(at, at + INSTANCE_WORDS), at)
      if (parked) held.words[at + INSTANCE.node] = NO_INDEX
    }
    if (arena.buffer || columns.placing) {
      const made = arena.made()
      writeInstances(from, to - from)
      arena.send(made, 0, header())
      held.dirty = false
    }
  }

  write(0, live())
  return {
    slots,
    held,
    arena,
    columns,
    posed,
    boxes,
    live,
    write,
    writeInstances,
    holdRecords,
    header,
    noteError,
    markOf,
  }
}
export type ProxyState = ReturnType<typeof createProxyState>
