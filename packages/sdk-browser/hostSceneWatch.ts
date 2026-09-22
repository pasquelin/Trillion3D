import type * as THREE from 'three';
import { asHostLibrary, type HostNode } from './hostResources.ts';
import type { WriteRevision } from './hostSceneHookCore.ts';
import { hookHostNode, unhookHostNode } from './hostSceneHooks.ts';
import { scan, snapshot, type NodeState, type WatchVerdict } from './hostSceneScan.ts';

/**
 * Mark of a node the engine created itself — an instance copy, for example. The host never
 * received it and therefore cannot write it: hooking it would listen for a write that never comes.
 */
export const ENGINE_OWNED = 'webGeometryEngineOwned';

/** What the engine draws, seen from here: each entry names the source node it comes from. A
 *  page of a selection root, a blended mesh outside the DAG: the same key, the same treatment. */
export type WatchedSources = ReadonlyArray<unknown>;

/** Source node of an entry, when it names one. */
function sourceOf(entry: unknown) {
  const shaped = entry as { sourceMesh?: THREE.Object3D } | undefined | null;
  return shaped ? shaped.sourceMesh : undefined;
}

/** Walks a node's chain up to the root: an ancestor's pose is the node's. */
function withAncestors(node: THREE.Object3D | undefined, into: Set<THREE.Object3D>) {
  let walk: THREE.Object3D | null = node ?? null;
  while (walk && !into.has(walk)) {
    into.add(walk);
    walk = walk.parent;
  }
}

/**
 * What the host can write into the source graph without going through the engine.
 *
 * The contract lets it move a node (`mesh.position.x = 100`), hide it, change a light's intensity
 * or pose. No engine API is called: no revision announces it, and a frame held on those
 * revisions would show a stale scene. What announces a POSE is the write itself: the position,
 * scale and rotation of the watched nodes are hooked (`hostSceneHooks.ts`), and a write of
 * another value increments this watch's revision at that instant. The rest — visibility, parent,
 * a matrix set by hand, a light's numbers — are the node's own data fields, which the reference
 * writes on its walk and which no hook may touch without slowing that walk: they are compared
 * per frame, a few values per node (`hostSceneScan.ts`).
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
  const mark: WriteRevision = { revision: 1 };
  let watched: NodeState[] = [],
    seen = 0;
  return {
    /**
     * Sets the list of watched nodes: the source models of what the engine draws, the lights,
     * and the ancestors of both, each read as it stands. To be called when the scene changes
     * shape — one more instance, a light set after the fact — never per frame: the scene change
     * that made the list stale is what announced it, and a node that enters the list is read
     * as-is by that same frame.
     */
    observe(node: HostNode, drawn: WatchedSources) {
      const source = asHostLibrary<THREE.Object3D>(node);
      const set = new Set<THREE.Object3D>();
      source.traverse((object) => {
        if (!(object as THREE.Light).isLight) return;
        withAncestors(object, set);
        withAncestors((object as THREE.DirectionalLight).target, set);
      });
      for (const entry of drawn) withAncestors(sourceOf(entry), set);
      for (const node of set) if (node.userData[ENGINE_OWNED]) set.delete(node);
      // With neither a declared root nor a light, there is nothing to hook: the whole graph is not a default.
      if (!set.size) withAncestors(source, set);
      for (const state of watched) if (!set.has(state.node)) unhookHostNode(state.node, mark);
      watched = [];
      for (const node of set) {
        hookHostNode(node, mark);
        watched.push(snapshot(node));
      }
    },
    /** Takes what the host wrote since the previous read: one integer for the hooked poses,
     *  and the scan of the other fields. `reshaped` says the list is to be rebuilt. */
    take(): WatchVerdict {
      let verdict: WatchVerdict = seen === mark.revision ? 0 : 'moved';
      seen = mark.revision;
      for (let i = 0; i < watched.length; i++) {
        const scanned = scan(watched[i]);
        if (scanned === 'reshaped') verdict = scanned;
        else if (scanned && !verdict) verdict = scanned;
      }
      return verdict;
    },
    /** The engine wrote the graph itself, under a scene revision it already incremented: the
     *  poses it bumped are taken as seen, and that scene revision has the list observed anew. */
    settle() {
      seen = mark.revision;
    },
    /** Forgets every node: their writes no longer reach this watch. */
    release() {
      for (const state of watched) unhookHostNode(state.node, mark);
      watched = [];
    },
  };
}
