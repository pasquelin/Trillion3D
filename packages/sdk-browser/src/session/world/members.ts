import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { LoadedModel } from './models/loadedModel.ts'
import { isLightNode, isVolumeNode } from '../../scene/host/graph/kinds.ts'
import { rootedUnder } from '../../scene/host/world/rooted.ts'

/**
 * Who a world's scene draws — its meshes and its loaded models —, kept up to date from the
 * parents whose children changed: each is compared with the children it had, and only the
 * subtrees that left or entered are walked. Adding one mesh to a scene of ten thousand reads
 * the scene root's list of children, never the ten thousand subtrees.
 */
export function createWorldMembers(scene: Object3D) {
  const known = new Map<Object3D, readonly Object3D[]>()
  const meshes = new Set<Mesh>(),
    models = new Set<LoadedModel>(),
    changed = new Set<Object3D>()
  /** The meshes wearing a volume material: voxelised into the fog's volume, drawn as no surface.
   *  `retyped` holds those whose material was written since the last `take`. */
  const volumes = new Set<Mesh>(),
    retyped = new Set<Mesh>()
  /** Raised when a light entered or left: the session's light store is written again. */
  let lit = false
  const rooted = (node: Object3D) => rootedUnder(node, scene)
  const enter = (node: Object3D, added: Mesh[]) =>
    node.traverse((child) => {
      known.set(child, child.children)
      lit ||= isLightNode(child)
      if ((child as Mesh).isMesh) {
        if (isVolumeNode(child)) volumes.add(child as Mesh)
        else if (!meshes.has(child as Mesh)) {
          meshes.add(child as Mesh)
          added.push(child as Mesh)
        }
      }
      if ((child as LoadedModel).isLoadedModel) models.add(child as LoadedModel)
    })
  /** What left with `node`: the subtree as it was known, never read again from the node, which may
   *  be destroyed by now. */
  const leave = (node: Object3D, removed: Mesh[]) => {
    const children = known.get(node) ?? []
    known.delete(node)
    lit ||= isLightNode(node)
    if (meshes.delete(node as Mesh)) removed.push(node as Mesh)
    volumes.delete(node as Mesh)
    retyped.delete(node as Mesh)
    models.delete(node as LoadedModel)
    for (const child of children) leave(child, removed)
  }
  /** A mesh whose material was written moves between the drawn meshes and the volumes where the
   *  material's domain changed. */
  const retype = (added: Mesh[], removed: Mesh[]) => {
    for (const mesh of retyped) {
      const volume = isVolumeNode(mesh)
      if (volume && meshes.delete(mesh)) removed.push(mesh)
      else if (!volume && volumes.delete(mesh)) {
        meshes.add(mesh)
        added.push(mesh)
      }
      if (volume) volumes.add(mesh)
    }
    retyped.clear()
  }
  return {
    meshes,
    volumes,
    models,
    /** `mesh`'s material was written: its domain is read again at the next `take`. */
    retype(mesh: Mesh) {
      if (meshes.has(mesh) || volumes.has(mesh)) retyped.add(mesh)
    },
    /** `parent`'s children changed: compared at the next `take`. */
    changed(parent: Object3D) {
      changed.add(parent)
    },
    /** `node` entered the scene: compared at the next `take` when it is known — it left and came
     *  back since —, otherwise entered whole with its parent, at no cost of its own. */
    entered(node: Object3D) {
      if (known.has(node)) changed.add(node)
    },
    /**
     * What entered the scene and what left it since the last call. Every subtree that left any
     * changed parent leaves first, then every one that entered a parent still in the scene
     * enters: a node moved from one parent to another is both, and stays a member.
     */
    take() {
      const added: Mesh[] = [],
        removed: Mesh[] = []
      lit = false
      // A parent destroyed since it was heard holds nothing in the scene any more.
      const diffs = [...changed].map((parent) => {
        const inScene = parent._alive && rooted(parent)
        return {
          parent,
          inScene,
          before: known.get(parent) ?? [],
          now: inScene ? parent.children : [],
        }
      })
      changed.clear()
      for (const { before, now } of diffs) {
        const kept = new Set(now)
        for (const child of before) if (!kept.has(child)) leave(child, removed)
      }
      for (const { parent, inScene, before, now } of diffs) {
        if (!inScene) continue
        const held = new Set(before)
        for (const child of now) if (!held.has(child)) enter(child, added)
        known.set(parent, now)
      }
      retype(added, removed)
      return { added, removed: removed.filter((mesh) => !meshes.has(mesh)), lights: lit }
    },
  }
}
