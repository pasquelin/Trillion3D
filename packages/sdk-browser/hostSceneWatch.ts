import type * as THREE from 'three';
import { hookHostNode, unhookHostNode, type WriteRevision } from './hostSceneHooks.ts';

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
 * revisions would show a stale scene. What announces it is the WRITE ITSELF: every field the
 * contract lets the host write is hooked on the watched nodes (`hostSceneHooks.ts`), and a
 * write of another value increments this watch's revision at that instant. The frame then
 * compares one integer to the one it last saw — no node is reread, whatever their number.
 *
 * What is hooked is bounded twice. By SOURCE NODES first: a drawn entry names the node it
 * comes from, and several entries of the same node hook it once. By the LOCAL pose next: an
 * ancestor's pose is hooked in its own right, and no world matrix is ever walked up here.
 *
 * The revision is monotonic and idempotent in the engine's favour: a write that went through
 * the engine API, which already incremented the scene revision, is settled by it and does not
 * trigger a second one.
 */
export function createHostSceneWatch() {
  const mark: WriteRevision = { revision: 1, reshaped: false };
  let watched: THREE.Object3D[] = [],
    seen = 0;
  return {
    /** True when a hooked write changed which objects are read: the list is to be rebuilt. */
    get reshaped() {
      return mark.reshaped;
    },
    /**
     * Sets the list of hooked nodes: the source models of what the engine draws, the lights,
     * and the ancestors of both. To be called when the scene changes shape — one more instance,
     * a light set after the fact — never per frame. A node that enters or leaves the list is
     * itself a change of the scene, announced by the next `changed()`.
     */
    observe(source: THREE.Object3D, drawn: WatchedSources) {
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
      let moved = false;
      for (const node of watched) if (!set.has(node) && unhookHostNode(node, mark)) moved = true;
      for (const node of set) if (hookHostNode(node, mark)) moved = true;
      watched = [...set];
      mark.reshaped = false;
      if (moved) mark.revision++;
    },
    /** Says whether the host wrote one of the hooked nodes since the previous read. Reads nothing else. */
    changed() {
      if (seen === mark.revision) return false;
      seen = mark.revision;
      return true;
    },
    /** The engine wrote the graph itself, under a scene revision it already incremented. */
    settle() {
      seen = mark.revision;
    },
    /** Forgets every node: their writes no longer reach this watch. */
    release() {
      for (const node of watched) unhookHostNode(node, mark);
      watched = [];
    },
  };
}
