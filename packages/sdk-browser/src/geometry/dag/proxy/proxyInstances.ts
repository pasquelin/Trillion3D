/**
 * THE PROXY KEPT TO THE PLACEMENTS IT TRACES: what a ray can meet of the scene beyond the visible
 * cut (`lighting/bounce/runtime/runtimeSceneWgsl.ts`) — the meshes the compiler built a proxy for (`proxy.bin`) and
 * the cuts the world made at run time, one structure. Its instances — four words a placement,
 * written next to the culling's own rows, the same `w` — are the `Instance` field of the culling's
 * records (`../worlds/worldTable.ts`), beside each placement's world; a blended mesh is a placement as any,
 * its pages a root's. The rest lies in one buffer its arena lays out and grows (`proxyArena.ts`):
 * the surfaces and the meshes' proxies, which take their spans there (`proxyColumns.ts`). The
 * placements' worlds and the placement tree are the culling's, read where they lie: nothing of them
 * is copied.
 *
 * A mesh's proxy reaches a placement through its primitive (`RootProxy.primitive`): a cut's at its
 * making, a compiled mesh's when the cache object arrives (`arrived`), which writes every instance
 * again.
 *
 * A placement out of the draw distances its object names, from the main view's eye, is met by no ray
 * (`distance`): its instance wears no node, as a parked one's.
 *
 * A member of the run (`../runtime/runtime.ts`): its operations tell it what moved — roots appended, a
 * placement parked or marked — and each cut refreshes the surfaces a host edited since. Without a
 * placement that wears a proxy, no buffer is made and `buffer()` answers none: the trace reads its
 * empty stand-ins.
 */
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { INSTANCE, INSTANCE_WORDS } from '../../../lighting/bounce/runtime/runtimeLayout.ts'
import { createProxyState, type ProxySource } from './proxyState.ts'
import { DAG_NODE_FLOATS, type PackedDag } from '../types.ts'
import { NODE_MAX, NODE_MIN } from '../nodeLayout.ts'
import { DRAW_DISTANCE_MARK } from '../frameTable.ts'
import { outsideDrawDistances } from '../drawDistance.ts'

/** What the pose reads of the deformation (`deformation/session.ts`): the float pool its records
 *  lie in, each placement's record in it (the first float plus one, zero for none) and the revision
 *  of the records. */
export type PoseHost = {
  pool: GPUBuffer | undefined
  recordOf(world: object): number
  revision: number
}

/** Whether placement `w`'s root's bounds' centre — the box of the node its descent starts from,
 *  through the placement's world — lies from `eye` out of its draw distances, `scale` times them
 *  (`packed.drawDistance`). */
function outsideRoot(packed: PackedDag, w: number, eye: ArrayLike<number>, scale: number) {
  const at = packed.rootBases[w] * DAG_NODE_FLOATS,
    { elements: m } = packed.worldSources[w].world,
    { nodes, drawDistance } = packed
  const c = [0, 1, 2].map((a) => 0.5 * (nodes[at + NODE_MIN + a] + nodes[at + NODE_MAX + a]))
  const centre = [0, 1, 2].map(
    (r) => m[r] * c[0] + m[4 + r] * c[1] + m[8 + r] * c[2] + m[12 + r] - eye[r],
  )
  return outsideDrawDistances(
    centre[0] ** 2 + centre[1] ** 2 + centre[2] ** 2,
    drawDistance?.[2 * w] ?? 0,
    drawDistance?.[2 * w + 1] ?? 0,
    scale,
  )
}

export function createProxyInstances(resources: ProxySource) {
  const state = createProxyState(resources),
    { slots, held, arena, posed, boxes, write, writeInstances, header, markOf } = state
  const { packed } = resources
  /** The placements that name a farthest draw distance (`DRAW_DISTANCE_MARK`). */
  const named = new Set<number>()
  const note = (w: number, mark: number) => {
    if (mark & DRAW_DISTANCE_MARK) named.add(w)
    else {
      named.delete(w)
      held.culled.delete(w)
    }
  }
  for (let w = 0; w < state.live(); w++) note(w, packed.mark[w] ?? 0)
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
     *  since the last call, and their extent: what the probes follow (`lighting/bounce/probes/probeSync.ts`). */
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
    /** Roots `[from, to)` were appended behind the others: their instances, and their worlds'
     *  boxes made again. */
    appended(from: number, to: number) {
      write(from, to)
      for (let w = from; w < to; w++) note(w, packed.mark[w] ?? 0)
    },
    /** Placement `w` parked, or taken back. */
    park(w: number, parked: boolean) {
      if (w >= slots) return
      boxes.mark(w)
      if (!arena.buffer) return
      const at = w * INSTANCE_WORDS,
        node = parked || held.culled.has(w) ? NO_INDEX : held.resolved[at + INSTANCE.node]
      if (held.words[at + INSTANCE.node] === node) return
      held.words[at + INSTANCE.node] = node
      writeInstances(w, 1)
    },
    /** Placement `w`'s frame word, its mark and the deformation's reach above it. */
    mark(w: number, mark: number) {
      if (w >= slots) return
      const culled = held.culled.has(w)
      note(w, mark)
      if (!arena.buffer) return
      const at = w * INSTANCE_WORDS,
        kept = markOf(w, mark)
      held.resolved[at + INSTANCE.mark] = kept
      // A placement that stops naming a distance is met again, its node back.
      const freed = culled && !held.culled.has(w)
      if (freed && packed.rootNodes[w] !== NO_INDEX)
        held.words[at + INSTANCE.node] = held.resolved[at + INSTANCE.node]
      if (held.words[at + INSTANCE.mark] === kept && !freed) return
      held.words[at + INSTANCE.mark] = kept
      writeInstances(w, 1)
    },
    /** The placements that name draw distances, those out of them from `eye` — the main view's, in
     *  the world's units — scaled by `scale` (`cutViewDistanceScale`) wearing no node from now on,
     *  those back in wearing it again: the centre of the root's bounds, as the cut tests it
     *  (`../shader/drawDistanceWgsl.ts`). `scale` undefined, the cull is off: every one is met.
     *  How many changed. */
    distance(eye: ArrayLike<number>, scale: number | undefined) {
      let changed = 0
      for (const w of named) {
        const out = scale !== undefined && outsideRoot(packed, w, eye, scale)
        if (out === held.culled.has(w)) continue
        if (out) held.culled.add(w)
        else held.culled.delete(w)
        const at = w * INSTANCE_WORDS
        held.words[at + INSTANCE.node] =
          out || packed.rootNodes[w] === NO_INDEX ? NO_INDEX : held.resolved[at + INSTANCE.node]
        writeInstances(w, 1)
        changed++
      }
      return changed
    },
    /** The surfaces a host edited since the last cut, written again. */
    refresh() {
      if (!arena.buffer) return
      arena.refreshSurfaces()
      if (held.dirty) {
        arena.send(arena.buffer, 0, header())
        held.dirty = false
      }
    },
    /** Bytes the CPU keeps for the proxy: the instance words as written and as resolved, the
     *  surface words and the world boxes (the cuts' columns are the primitives', counted
     *  with the scene proxy's cache object). What the streamer's reservation counts. */
    get hostBytes() {
      return held.words.byteLength + held.resolved.byteLength + arena.hostBytes + boxes.hostBytes
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
