import type { Object3D } from '../../../sdk-core/world/object/object3d.ts';
import type { Mesh } from '../../../sdk-core/world/object/mesh.ts';
import type { LoadedModel } from './loadedModel.ts';
import { isLight } from './worldLights.ts';
import { rootedUnder } from './worldPoses.ts';

/**
 * Who a world's scene draws — its meshes and its loaded models —, kept up to date from the
 * parents whose children changed: each is compared with the children it had, and only the
 * subtrees that left or entered are walked. Adding one mesh to a scene of ten thousand reads
 * the scene root's list of children, never the ten thousand subtrees.
 */
export function createWorldMembers(scene: Object3D) {
  const known = new Map<Object3D, readonly Object3D[]>();
  const meshes = new Set<Mesh>(),
    models = new Set<LoadedModel>(),
    changed = new Set<Object3D>();
  /** Raised when a light entered or left: the session's light store is written again. */
  let lit = false;
  const rooted = (node: Object3D) => rootedUnder(node, scene);
  const enter = (node: Object3D, added: Mesh[]) =>
    node.traverse((child) => {
      known.set(child, child.children);
      lit ||= isLight(child);
      if ((child as Mesh).isMesh && !meshes.has(child as Mesh)) {
        meshes.add(child as Mesh);
        added.push(child as Mesh);
      }
      if ((child as LoadedModel).isLoadedModel) models.add(child as LoadedModel);
    });
  const leave = (node: Object3D, removed: Mesh[]) =>
    node.traverse((child) => {
      known.delete(child);
      lit ||= isLight(child);
      if (meshes.delete(child as Mesh)) removed.push(child as Mesh);
      models.delete(child as LoadedModel);
    });
  return {
    meshes,
    models,
    /** `parent`'s children changed: compared at the next `take`. */
    changed(parent: Object3D) {
      changed.add(parent);
    },
    /**
     * What entered the scene and what left it since the last call. Every subtree that left any
     * changed parent leaves first, then every one that entered a parent still in the scene
     * enters: a node moved from one parent to another is both, and stays a member.
     */
    take() {
      const added: Mesh[] = [],
        removed: Mesh[] = [];
      lit = false;
      const diffs = [...changed].map((parent) => ({
        parent,
        before: known.get(parent) ?? [],
        now: rooted(parent) ? parent.children : [],
      }));
      changed.clear();
      for (const { before, now } of diffs) {
        const kept = new Set(now);
        for (const child of before) if (!kept.has(child)) leave(child, removed);
      }
      for (const { parent, before, now } of diffs) {
        if (!rooted(parent)) continue;
        const held = new Set(before);
        for (const child of now) if (!held.has(child)) enter(child, added);
        known.set(parent, now);
      }
      return { added, removed: removed.filter((mesh) => !meshes.has(mesh)), lights: lit };
    },
  };
}
