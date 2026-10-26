import { aimOf, isLightNode } from '../graph/kinds.ts'
import type { WriteRevision } from './hookCore.ts'
import { hookHostNode, unhookHostNode } from './hooks.ts'
import {
  SCAN_FLIPPED,
  SCAN_POSED,
  SCAN_RESHAPED,
  adoptPose,
  scan,
  snapshot,
  verdictOf,
  type NodeState,
  type WatchVerdict,
} from './scan.ts'
import { nodeWrites, nodesWrittenSince } from '../../../../../sdk-core/src/scene/core/nodeEdits.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { DrawSource } from '../../../geometry/selection/drawSource.ts'

/**
 * The nodes the engine created itself — an instance copy, for example. The page never received
 * them and therefore cannot write them: hooking one would listen for a write that never comes.
 */
export const ENGINE_OWNED = new WeakSet<Object3D>()

/** No node flipped. */
const NONE: readonly Object3D[] = []

/** What the engine draws, seen from here: each entry names the source node it comes from. A
 *  page of a selection root, a blended mesh outside the DAG: the same key, the same treatment. */
export type WatchedSources = ReadonlyArray<unknown>

/** Source node of an entry, when it names one. */
function sourceOf(entry: unknown) {
  const shaped = entry as { drawSource?: DrawSource } | undefined | null
  return shaped?.drawSource?.node
}

/** The source node of an entry with its chain, and the bones that deform it with theirs: a bone's
 *  pose moves the drawn skin as the node's own does. A node destroyed is watched no more. */
function watchSource(entry: unknown, into: Set<Object3D>) {
  const node = sourceOf(entry)
  if (!node?._alive) return
  withAncestors(node, into)
  const bones = (node as { skeleton?: { bones: readonly Object3D[] } }).skeleton?.bones
  if (bones) for (const bone of bones) withAncestors(bone, into)
}

/** Walks a node's chain up to the root: an ancestor's pose is the node's. */
function withAncestors(node: Object3D | undefined, into: Set<Object3D>) {
  let walk: Object3D | null = node ?? null
  while (walk && !into.has(walk)) {
    into.add(walk)
    walk = walk.parent
  }
}

/** What a watch keeps between its takes. */
type Watch = {
  /** The nodes a hooked pose was written on, or a scan found posed, since they were last taken, in
   *  the order first written: what the engine follows of the host's writes (`takeWritten`). */
  written: Set<Object3D>
  spare: Set<Object3D>
  mark: WriteRevision
  /** The watched nodes by their slot in the page's tree, where the journal names them. */
  states: Map<number, NodeState>
  seen: number
  /** The nodes a scan found shown, hidden, set to cast or not, since they were last taken. */
  flipped: Object3D[]
  /** The engine's write count the watched nodes were last read under. */
  writesRead: number
  /** How many reads were made: a node is compared once a read. */
  reads: number
  /** A watched node was destroyed since the last call (`takeDestroyed`). */
  destroyed: boolean
  verdict: WatchVerdict
  /** The node of journal slot `slot` compared with what was last read of it. */
  scanWritten: (slot: number) => void
}

/** `state` compared with its node, once a read: a flip and a pose move noted each on its own. */
function scanOnce(w: Watch, state: NodeState) {
  if (state.read === w.reads) return
  state.read = w.reads
  const found = scan(state),
    read = verdictOf(found)
  if (read === 'reshaped') w.verdict = read
  else if (read && !w.verdict) w.verdict = read
  if (found & SCAN_RESHAPED) {
    // A node destroyed has no subtree to read its roots in: every root is walked. One moved
    // under another poses and shows the roots under it, they alone.
    if (!state.node._alive) return void (w.destroyed = true)
    w.flipped.push(state.node)
    w.written.add(state.node)
    return
  }
  if (found & SCAN_FLIPPED) w.flipped.push(state.node)
  if (found & SCAN_POSED) w.written.add(state.node)
}

/**
 * Sets the list of watched nodes: the source models of what the engine draws, the lights,
 * and the ancestors of both. To be called when the scene changes shape — one more instance,
 * a node reparented — never per frame: the scene change that made the list stale is what
 * announced it. A node still watched keeps what was last read of it, and the writes the
 * journal holds for it are read at the next take; a node that enters the list is read as it
 * stands.
 */
function observeNodes(w: Watch, source: Object3D, drawn: WatchedSources) {
  const set = new Set<Object3D>()
  source.traverse((object) => {
    if (!isLightNode(object)) return
    withAncestors(object, set)
    withAncestors(aimOf(object), set)
  })
  for (const entry of drawn) watchSource(entry, set)
  for (const node of set) if (ENGINE_OWNED.has(node)) set.delete(node)
  // With neither a declared root nor a light, there is nothing to hook: the whole graph is not a default.
  if (!set.size) withAncestors(source, set)
  const held = w.states
  for (const state of held.values()) if (!set.has(state.node)) unhookHostNode(state.node, w.mark)
  w.states = new Map()
  for (const node of set) {
    hookHostNode(node, w.mark)
    const kept = held.get(node.index)
    w.states.set(node.index, kept?.node === node ? kept : snapshot(node))
  }
  if (w.writesRead < 0) w.writesRead = nodeWrites()
}

/** Takes what the host wrote since the previous read: one integer for the hooked poses, and
 *  for the other fields the scan of the watched nodes written since (`nodesWrittenSince`) —
 *  every watched node only once the journal no longer holds them all. A write the scan itself
 *  makes — a matrix taken into the tree — is read at the next take. `reshaped` says the list
 *  is to be rebuilt. */
function takeWrites(w: Watch): WatchVerdict {
  w.verdict = w.seen === w.mark.revision ? 0 : 'moved'
  w.seen = w.mark.revision
  const to = nodeWrites()
  if (to === w.writesRead) return w.verdict
  w.reads++
  if (!nodesWrittenSince(w.writesRead, w.scanWritten, to))
    for (const state of w.states.values()) scanOnce(w, state)
  w.writesRead = to
  return w.verdict
}

/** A watch that has seen nothing yet. */
function newWatch(): Watch {
  const w: Watch = {
    ...{ written: new Set<Object3D>(), spare: new Set<Object3D>() },
    ...{ states: new Map<number, NodeState>(), flipped: [] as Object3D[] },
    mark: { revision: 1, wrote: (node) => void w.written.add(node) },
    ...{ seen: 0, writesRead: -1, reads: 0, destroyed: false },
    verdict: 0,
    scanWritten(slot) {
      const state = w.states.get(slot)
      if (state) scanOnce(w, state)
    },
  }
  return w
}

/**
 * What the host can write into the source graph without going through the engine.
 *
 * The contract lets it move a node (`mesh.position.x = 100`), hide it, change a light's intensity
 * or pose. No engine API is called: no revision announces it, and a frame held on those
 * revisions would show a stale scene. What announces a POSE is the write itself: the position,
 * scale and rotation of the watched nodes are hooked (`hooks.ts`), and a write of
 * another value increments this watch's revision at that instant. The rest — visibility, parent,
 * a matrix set by hand, a light's numbers and colours — are noted by the engine with their node
 * as they are written (`nodeWrites`): while that count stands, nothing is read; once it moves, the
 * watched nodes written since are compared to what was last read (`scan.ts`), they alone, so a
 * write of the value already held is still nothing. The nodes written, a pose or a field, are
 * kept for the engine (`takeWritten`), which follows them and nothing else. Numbers written straight into an array or a colour the node handed out are
 * counted once announced: `matrixWorldNeedsUpdate = true`, a light's `needsUpdate = true`.
 *
 * What is watched is bounded twice. By SOURCE NODES first: a drawn entry names the node it
 * comes from, and several entries of the same node hook it once. By the LOCAL pose next: an
 * ancestor's pose is hooked in its own right, and no world matrix is ever walked up here.
 *
 * The revision is monotonic and idempotent in the engine's favour: a write that went through
 * the engine API, which already incremented the scene revision, is settled by it and does not
 * trigger a second one.
 */
export function createHostSceneWatch() {
  const w = newWatch()
  return {
    observe: (source: Object3D, drawn: WatchedSources) => observeNodes(w, source, drawn),
    take: () => takeWrites(w),
    /** Whether a scan found a watched node destroyed since the last call: the roots it drew are no
     *  longer found under it, so the caller reads every root. A node reparented is not that: it is
     *  taken as written and flipped, and the roots under it alone follow. */
    takeDestroyed(): boolean {
      const taken = w.destroyed
      w.destroyed = false
      return taken
    },
    /** The nodes the scans found shown, hidden, set to cast or not since the last call, each
     *  where it was flipped: what their roots follow, none other (`followHostVisibility`). */
    takeFlipped(): readonly Object3D[] {
      if (!w.flipped.length) return NONE
      const taken = w.flipped
      w.flipped = []
      return taken
    },
    /** The nodes a hooked pose was written on, or a scan found posed, since the last call, in the
     *  order first written: what names the roots under them
     *  (`../../../frame/render/movedBatch.ts`). */
    takeWritten(): ReadonlySet<Object3D> {
      const taken = w.written
      w.written = w.spare
      w.written.clear()
      w.spare = taken
      return taken
    },
    /** The engine posed `node` itself (`../../../frame/render/transform.ts`): what this watch
     *  holds of it follows, so the engine's pose is not read back as the host's. */
    adopt(node: Object3D) {
      const state = w.states.get(node.index)
      if (state?.node === node) adoptPose(state)
    },
    /** True when the host wrote a hooked pose this watch has not taken or settled yet. Nothing
     *  is hooked before the first observation: no host write can be pending there. */
    pending: () => w.states.size > 0 && w.seen !== w.mark.revision,
    /** The engine wrote the graph itself, under a scene revision it already incremented: the
     *  poses it bumped are taken as seen. */
    settle() {
      w.seen = w.mark.revision
    },
    /** Forgets every node: their writes no longer reach this watch. */
    release() {
      for (const state of w.states.values()) unhookHostNode(state.node, w.mark)
      w.states = new Map()
    },
  }
}
