import { aimOf, isLightNode } from '../graph/kinds.ts'
import type { WriteRevision } from './hookCore.ts'
import { hookHostNode, unhookHostNode } from './hooks.ts'
import { scan, snapshot, type NodeState, type WatchVerdict } from './scan.ts'
import { nodeWrites } from '../../../../sdk-core/src/scene/core/nodeEdits.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * Mark of a node the engine created itself — an instance copy, for example. The host never
 * received it and therefore cannot write it: hooking it would listen for a write that never comes.
 */
export const ENGINE_OWNED = 'trillion3dEngineOwned'

/** No node flipped. */
const NONE_FLIPPED: readonly Object3D[] = []

/** What the engine draws, seen from here: each entry names the source node it comes from. A
 *  page of a selection root, a blended mesh outside the DAG: the same key, the same treatment. */
export type WatchedSources = ReadonlyArray<unknown>

/** Source node of an entry, when it names one. */
function sourceOf(entry: unknown) {
  const shaped = entry as { sourceMesh?: Object3D } | undefined | null
  return shaped ? shaped.sourceMesh : undefined
}

/** The source node of an entry with its chain, and the bones that deform it with theirs: a bone's
 *  pose moves the drawn skin as the node's own does. */
function watchSource(entry: unknown, into: Set<Object3D>) {
  const node = sourceOf(entry)
  if (!node) return
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
 * a matrix set by hand, a light's numbers and colours — are counted by the engine as they are
 * written (`nodeWrites`): while that count stands, nothing is read; once it moves, the watched
 * nodes are compared to what was last read (`scan.ts`), so a write of the value already held is
 * still nothing. Numbers written straight into an array or a colour the node handed out are
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
  const mark: WriteRevision = { revision: 1 }
  let watched: NodeState[] = [],
    seen = 0,
    // The nodes a scan found shown, hidden, set to cast or not, since they were last taken.
    flipped: Object3D[] = [],
    // The engine's write count the watched nodes were last read under.
    writesRead = -1
  return {
    /**
     * Sets the list of watched nodes: the source models of what the engine draws, the lights,
     * and the ancestors of both, each read as it stands. To be called when the scene changes
     * shape — one more instance, a light set after the fact — never per frame: the scene change
     * that made the list stale is what announced it, and a node that enters the list is read
     * as-is by that same frame.
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
      for (const state of watched) if (!set.has(state.node)) unhookHostNode(state.node, mark)
      watched = []
      for (const node of set) {
        hookHostNode(node, mark)
        watched.push(snapshot(node))
      }
      writesRead = nodeWrites()
    },
    /** Takes what the host wrote since the previous read: one integer for the hooked poses, one
     *  for the other fields, and the scan of those fields only when their count moved. The count
     *  is read after the scan: a matrix the scan takes into the tree counts as a write of its own.
     *  `reshaped` says the list is to be rebuilt. */
    take(): WatchVerdict {
      let verdict: WatchVerdict = seen === mark.revision ? 0 : 'moved'
      seen = mark.revision
      if (nodeWrites() === writesRead) return verdict
      for (let i = 0; i < watched.length; i++) {
        const state = watched[i],
          visible = state.visible,
          castShadow = state.castShadow
        const scanned = scan(state)
        if (state.visible !== visible || state.castShadow !== castShadow) flipped.push(state.node)
        if (scanned === 'reshaped') verdict = scanned
        else if (scanned && !verdict) verdict = scanned
      }
      writesRead = nodeWrites()
      return verdict
    },
    /** The nodes the scans found shown, hidden, set to cast or not since the last call, each
     *  where it was flipped: what their roots follow, none other (`followHostVisibility`). */
    takeFlipped(): readonly Object3D[] {
      if (!flipped.length) return NONE_FLIPPED
      const taken = flipped
      flipped = []
      return taken
    },
    /** True when the host wrote a hooked pose this watch has not taken or settled yet. Nothing
     *  is hooked before the first observation: no host write can be pending there. */
    pending: () => watched.length > 0 && seen !== mark.revision,
    /** The engine wrote the graph itself, under a scene revision it already incremented: the
     *  poses it bumped are taken as seen, and that scene revision has the list observed anew. */
    settle() {
      seen = mark.revision
    },
    /** Forgets every node: their writes no longer reach this watch. */
    release() {
      for (const state of watched) unhookHostNode(state.node, mark)
      watched = []
    },
  }
}
