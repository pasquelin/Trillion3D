import { aimOf, isLightNode } from '../graph/kinds.ts'
import type { WriteRevision } from './hookCore.ts'
import { hookHostNode, unhookHostNode } from './hooks.ts'
import {
  SCAN_FLIPPED,
  SCAN_MOVED,
  SCAN_POSED,
  SCAN_RESHAPED,
  adoptPose,
  scan,
  snapshot,
  type NodeState,
  type WatchVerdict,
} from './scan.ts'
import { nodeWrites, nodesWrittenSince } from '../../../../sdk-core/src/scene/core/nodeEdits.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * Mark of a node the engine created itself — an instance copy, for example. The host never
 * received it and therefore cannot write it: hooking it would listen for a write that never comes.
 */
export const ENGINE_OWNED = 'trillion3dEngineOwned'

/** No node flipped. */
const NONE: readonly Object3D[] = []

/** What the engine draws, seen from here: each entry names the source node it comes from. A
 *  page of a selection root, a blended mesh outside the DAG: the same key, the same treatment. */
export type WatchedSources = ReadonlyArray<unknown>

/** Source node of an entry, when it names one. */
function sourceOf(entry: unknown) {
  const shaped = entry as { sourceMesh?: Object3D } | undefined | null
  return shaped ? shaped.sourceMesh : undefined
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
  // The nodes a hooked pose was written on, or a scan found posed, since they were last taken, in
  // the order first written: what the engine follows of the host's writes (`takeWritten`).
  let written = new Set<Object3D>(),
    spare = new Set<Object3D>()
  const mark: WriteRevision = { revision: 1, wrote: (node) => void written.add(node) }
  // The watched nodes by their slot in the page's tree, where the journal names them.
  let states = new Map<number, NodeState>(),
    seen = 0,
    // The nodes a scan found shown, hidden, set to cast or not, since they were last taken.
    flipped: Object3D[] = [],
    // The engine's write count the watched nodes were last read under.
    writesRead = -1,
    // How many reads were made: a node is compared once a read.
    reads = 0,
    verdict: WatchVerdict = 0
  /** `state` compared with its node, once a read: a flip and a pose move noted each on its own. */
  const scanOnce = (state: NodeState) => {
    if (state.read === reads) return
    state.read = reads
    const found = scan(state)
    if (found & SCAN_RESHAPED) verdict = 'reshaped'
    else if (found & SCAN_MOVED && !verdict) verdict = 'moved'
    if (found & SCAN_RESHAPED) return
    if (found & SCAN_FLIPPED) flipped.push(state.node)
    if (found & SCAN_POSED) written.add(state.node)
  }
  const scanWritten = (slot: number) => {
    const state = states.get(slot)
    if (state) scanOnce(state)
  }
  return {
    /**
     * Sets the list of watched nodes: the source models of what the engine draws, the lights,
     * and the ancestors of both. To be called when the scene changes shape — one more instance,
     * a node reparented — never per frame: the scene change that made the list stale is what
     * announced it. A node still watched keeps what was last read of it, and the writes the
     * journal holds for it are read at the next take; a node that enters the list is read as it
     * stands.
     */
    observe(source: Object3D, drawn: WatchedSources) {
      const set = new Set<Object3D>()
      source.traverse((object) => {
        if (!isLightNode(object)) return
        withAncestors(object, set)
        withAncestors(aimOf(object), set)
      })
      for (const entry of drawn) watchSource(entry, set)
      for (const node of set) if (node.userData[ENGINE_OWNED]) set.delete(node)
      // With neither a declared root nor a light, there is nothing to hook: the whole graph is not a default.
      if (!set.size) withAncestors(source, set)
      const held = states
      for (const state of held.values()) if (!set.has(state.node)) unhookHostNode(state.node, mark)
      states = new Map()
      for (const node of set) {
        hookHostNode(node, mark)
        const kept = held.get(node.index)
        states.set(node.index, kept?.node === node ? kept : snapshot(node))
      }
      if (writesRead < 0) writesRead = nodeWrites()
    },
    /** Takes what the host wrote since the previous read: one integer for the hooked poses, and
     *  for the other fields the scan of the watched nodes written since (`nodesWrittenSince`) —
     *  every watched node only once the journal no longer holds them all. A write the scan itself
     *  makes — a matrix taken into the tree — is read at the next take. `reshaped` says the list
     *  is to be rebuilt. */
    take(): WatchVerdict {
      verdict = seen === mark.revision ? 0 : 'moved'
      seen = mark.revision
      const to = nodeWrites()
      if (to === writesRead) return verdict
      reads++
      if (!nodesWrittenSince(writesRead, scanWritten, to))
        for (const state of states.values()) scanOnce(state)
      writesRead = to
      return verdict
    },
    /** The nodes the scans found shown, hidden, set to cast or not since the last call, each
     *  where it was flipped: what their roots follow, none other (`followHostVisibility`). */
    takeFlipped(): readonly Object3D[] {
      if (!flipped.length) return NONE
      const taken = flipped
      flipped = []
      return taken
    },
    /** The nodes a hooked pose was written on, or a scan found posed, since the last call, in the
     *  order first written: what names the roots under them
     *  (`../../webgpu/pages/render/movedBatch.ts`). */
    takeWritten(): ReadonlySet<Object3D> {
      const taken = written
      written = spare
      written.clear()
      spare = taken
      return taken
    },
    /** The engine posed `node` itself (`../../webgpu/pages/render/transform.ts`): what this watch
     *  holds of it follows, so the engine's pose is not read back as the host's. */
    adopt(node: Object3D) {
      const state = states.get(node.index)
      if (state?.node === node) adoptPose(state)
    },
    /** True when the host wrote a hooked pose this watch has not taken or settled yet. Nothing
     *  is hooked before the first observation: no host write can be pending there. */
    pending: () => states.size > 0 && seen !== mark.revision,
    /** The engine wrote the graph itself, under a scene revision it already incremented: the
     *  poses it bumped are taken as seen. */
    settle() {
      seen = mark.revision
    },
    /** Forgets every node: their writes no longer reach this watch. */
    release() {
      for (const state of states.values()) unhookHostNode(state.node, mark)
      states = new Map()
    },
  }
}
