import * as THREE from 'three';
import { readLightInto, LIGHT_SLOTS } from './hostSceneLightState.ts';

/** Slot reserved for a node: visibility, recomposition flag, and sixteen pose values — its set
 *  matrix, or its translation, rotation and scale. A fixed slot, so the loop has neither to
 *  measure nor to offset anything. */
const NODE_SLOTS = 18;

/**
 * Mark of a node the engine created itself — an instance copy, for example. The host never
 * received it and therefore cannot write it: rereading it would pay a comparison for a value
 * known not to move.
 */
export const ENGINE_OWNED = 'webGeometryEngineOwned';

/** Pose of a node that recomposes its matrix, reread without allocation. */
const poseScratch = new Float64Array(10);

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
 * revisions would show a stale scene. The only honest way to know is to reread what the
 * contract lets write and compare it to what the last frame read.
 *
 * What is reread is bounded twice. By SOURCE NODES first: a drawn entry names the node it comes
 * from, and several entries of the same node reread it only once. By the LOCAL pose next: no
 * world matrix is walked up or multiplied to know if something moved, since a world matrix is a
 * product of locals.
 *
 * Read and compare are the same pass, in a flat array, with neither allocation nor a per-node
 * call: the frame pays only one comparison per reread value. The comparison is exact — values
 * are kept, not a fingerprint — and idempotent: it compares a state to the one it holds, so a
 * write that went through the engine API, which already incremented the scene revision, does
 * not trigger a second one.
 */
export function createHostSceneWatch() {
  let watched: THREE.Object3D[] = [],
    lights: THREE.Light[] = [],
    held = new Float64Array(0),
    posed = false;
  return {
    /**
     * Sets the list of reread nodes: the source models of what the engine draws, the lights,
     * and the ancestors of both. To be called when the scene changes shape — one more instance,
     * a light set after the fact — never per frame.
     */
    observe(source: THREE.Object3D, drawn: WatchedSources) {
      const set = new Set<THREE.Object3D>();
      lights = [];
      source.traverse((object) => {
        if ((object as THREE.Light).isLight) {
          const light = object as THREE.Light;
          lights.push(light);
          withAncestors(light, set);
          withAncestors((light as THREE.DirectionalLight).target, set);
        }
      });
      for (const entry of drawn) withAncestors(sourceOf(entry), set);
      for (const node of set) if (node.userData[ENGINE_OWNED]) set.delete(node);
      // With neither a declared root nor a light, there is nothing to reread: the whole graph is not a default.
      if (!set.size) withAncestors(source, set);
      watched = [...set];
      const need = watched.length * NODE_SLOTS + lights.length * LIGHT_SLOTS;
      // Held state survives a list reset identically: otherwise each announcement would trigger
      // another and the scene would never go quiet. A list of another size drops it, and the
      // first comparison that follows announces a change, which is exact.
      if (held.length !== need) {
        held = new Float64Array(need);
        posed = false;
      }
    },
    /** Says whether the host wrote one of the reread nodes since the previous read. Walks nothing up. */
    changed() {
      const h = held;
      let moved = !posed,
        at = 0;
      posed = true;
      for (let i = 0; i < watched.length; i++) {
        const node = watched[i],
          auto = node.matrixAutoUpdate,
          visible = node.visible ? 1 : 0,
          flag = auto ? 1 : 0;
        if (h[at] !== visible) {
          h[at] = visible;
          moved = true;
        }
        if (h[at + 1] !== flag) {
          h[at + 1] = flag;
          moved = true;
        }
        at += 2;
        if (auto) {
          // The node recomposes its matrix from these ten values: those are what the host writes.
          const { position: p, quaternion: q, scale: s } = node;
          poseScratch[0] = p.x;
          poseScratch[1] = p.y;
          poseScratch[2] = p.z;
          poseScratch[3] = q.x;
          poseScratch[4] = q.y;
          poseScratch[5] = q.z;
          poseScratch[6] = q.w;
          poseScratch[7] = s.x;
          poseScratch[8] = s.y;
          poseScratch[9] = s.z;
          for (let k = 0; k < 10; k++)
            if (h[at + k] !== poseScratch[k]) {
              h[at + k] = poseScratch[k];
              moved = true;
            }
          // The last six slots belong to the set matrix: this node does not read it, and the
          // flag that would say so already announced the change the day it would switch.
        } else {
          const e = node.matrix.elements;
          for (let k = 0; k < 16; k++)
            if (h[at + k] !== e[k]) {
              h[at + k] = e[k];
              moved = true;
            }
        }
        at += NODE_SLOTS - 2;
      }
      for (let i = 0; i < lights.length; i++) {
        if (readLightInto(lights[i], h, at)) moved = true;
        at += LIGHT_SLOTS;
      }
      return moved;
    },
  };
}
