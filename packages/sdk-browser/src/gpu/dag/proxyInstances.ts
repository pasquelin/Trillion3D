/**
 * THE PROXY KEPT TO THE PLACEMENTS IT TRACES: what a ray can meet of the scene beyond the visible
 * cut (`bounce/runtimeSceneWgsl.ts`) — the meshes the compiler built a proxy for (`proxy.bin`) and
 * the cuts the world made at run time, one structure. Its instances — four words a placement,
 * written next to the culling's own rows, the same `w`, then one for each blended copy the forward
 * family draws (the members after the placements: they are no member of the culling's tree) — are
 * the `Instance` field of the culling's records (`worldTable.ts`), beside each placement's world:
 * the table grows for the copies (`RecordTexture.hold`). The rest lies in one buffer its arena lays
 * out and grows (`proxyArena.ts`): the copies' worlds (`proxyCopies.ts`), the surfaces and the
 * meshes' proxies, which take their spans there (`proxyColumns.ts`). The placements' worlds and the
 * placement tree are the culling's, read where they lie: nothing of them is copied.
 *
 * A mesh's proxy reaches a placement through its primitive (`RootProxy.primitive`): a cut's at its
 * making, a compiled mesh's when the cache object arrives (`arrived`), which writes every instance
 * again.
 *
 * A member of the run (`runtime.ts`): its operations tell it what moved — roots appended, a
 * placement parked or marked — and each cut refreshes the surfaces a host edited and the copies
 * that moved since. Without a placement or a copy that wears a proxy, no buffer is made and
 * `buffer()` answers none: the trace reads its empty stand-ins.
 */
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { INSTANCE, INSTANCE_WORDS } from '../../bounce/runtimeLayout.ts'
import { createProxyCopies } from './proxyCopies.ts'
import type { RootProxy } from '../../page/selection/types.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { createProxyState, type ProxySource } from './proxyState.ts'

/** A blended copy as the proxy reads it: its cut and surface, the pose it aliases and whether it is
 *  drawn (`BlendCopy`). */
export type ProxyCopy = {
  proxy?: RootProxy
  matrix: { readonly elements: ArrayLike<number> }
  hidden?: boolean
  placement?: PlacementOf
}

/** What the pose reads of the deformation (`deformation/session.ts`): the float pool its records
 *  lie in, each placement's record in it (the first float plus one, zero for none) and the revision
 *  of the records. */
export type PoseHost = {
  pool: GPUBuffer | undefined
  recordOf(world: object): number
  revision: number
}

export function createProxyInstances(resources: ProxySource) {
  const state = createProxyState(resources),
    { slots, held, arena, posed, boxes, write, writeInstances, header, markOf } = state,
    copies = createProxyCopies(state)
  /** Row `w` of the culling's world table was written: its box is made again at the next
   *  `worldBoxes`. */
  function worldWritten(w: number) {
    if (w < 0 || w >= slots) return
    boxes.mark(w)
  }
  return {
    /** The buffer a program reads the proxy through, or none: it then reads the stand-ins. */
    buffer() {
      return arena.buffer
    },
    /** The world box of each placement that wears a proxy, and which of them are new or moved
     *  since the last call: what the probes' occupancy map keeps (`bounce/probes.ts`). */
    worldBoxes: boxes.worldBoxes,
    /** The deformed placements' copies posed, in `encoder`, before the first program of the image
     *  that traces them (`proxyPosed.ts`). */
    pose: (encoder: GPUCommandEncoder, host: PoseHost) => posed.pose(encoder, host),
    /** The meshes' proxies of a compiled scene arrived (`RootProxy.primitive.runtimeProxy` was
     *  set): every placement wears what its primitive holds now. */
    arrived() {
      write(0, state.live())
    },
    /** Rows `rows[0..count)` of the culling's world table were written (a pose, a park, a
     *  composition under a moved parent): their boxes are made again. */
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
    /** The blended copies the forward family draws, members of this proxy after the placements:
     *  their poses are the host's (`BlendCopy.matrix`), read again at each cut. */
    setCopies: copies.set,
    /** Placement `w` parked, or taken back. */
    park(w: number, parked: boolean) {
      if (w >= slots) return
      boxes.mark(w)
      if (!arena.buffer) return
      const at = w * INSTANCE_WORDS,
        node = parked ? NO_INDEX : held.resolved[at + INSTANCE.node]
      if (held.words[at + INSTANCE.node] === node) return
      held.words[at + INSTANCE.node] = node
      writeInstances(w, 1)
    },
    /** Placement `w`'s frame word, its mark and the deformation's reach above it. */
    mark(w: number, mark: number) {
      if (!arena.buffer || w >= slots) return
      const at = w * INSTANCE_WORDS + INSTANCE.mark,
        kept = markOf(w, mark)
      held.resolved[at] = kept
      if (held.words[at] === kept) return
      held.words[at] = kept
      writeInstances(w, 1)
    },
    /** The surfaces a host edited and the copies that moved since the last cut, written again. */
    refresh() {
      if (held.copies.length !== copies.held()) copies.set(held.copies)
      if (!arena.buffer && !held.copies.length) return
      arena.refreshSurfaces()
      copies.sync()
      if (arena.buffer && held.dirty) {
        arena.send(arena.buffer, 0, header())
        held.dirty = false
      }
    },
    /** Bytes the CPU keeps for the proxy: the instance words as written and as resolved, the
     *  surface and copy words and the world boxes (the cuts' columns are the primitives', counted
     *  with the scene proxy's cache object). What the streamer's reservation counts. */
    get hostBytes() {
      return (
        held.words.byteLength +
        held.resolved.byteLength +
        arena.hostBytes +
        held.copyWorlds.byteLength +
        boxes.hostBytes
      )
    },
    /** Bytes of the buffer: what the cut's memory budget counts; the instances are the records',
     *  the cut's own. */
    get bytes() {
      return arena.buffer?.size ?? 0
    },
    dispose() {
      arena.dispose()
      posed.dispose()
    },
  }
}
export type ProxyInstances = ReturnType<typeof createProxyInstances>
