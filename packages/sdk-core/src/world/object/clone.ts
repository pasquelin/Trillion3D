import { Group, Object3D } from './object3d.ts'
import { Mesh } from './mesh.ts'
import { Sprite } from './sprite.ts'
import { Light } from '../light/light.ts'
import { WaterExclusionVolume } from './waterExclusionVolume.ts'

/** The node classes a copy builds again; any other — a loaded model, a camera — is left out. */
const COPIED = new Set<unknown>([Object3D, Group, Mesh, Sprite, Light, WaterExclusionVolume])

/**
 * A copy of `source` and of everything under it, its shapes and materials its own: a later edit
 * of one leaves the other alone (a skinned copy still bends by the same bones). Every field a saved scene keeps is copied — name, pose, visibility,
 * shadows, `renderOrder`, `userData` (as JSON, like a saved scene), a mesh's `primitive`, a
 * sprite's `center`, a light's values, a water exclusion volume's mode and bodies. A node of a class built elsewhere (a loaded model, a camera) is not copied:
 * `null` for it, and it is left out of a copied subtree. A reference between nodes of the copied subtree (the bodies a water exclusion
 * volume names) points at their copies; one to a node outside it stays.
 */
export function cloneObject<T extends Object3D>(source: T): T | null {
  const made = new Map<Object3D, Object3D>()
  const copy = copyNode(source, made)
  for (const node of made.values())
    if (node instanceof WaterExclusionVolume) node.bodies = node.bodies.map((b) => made.get(b) ?? b)
  return copy
}

/** The copy of `source` and its subtree, each node's copy recorded in `made`. */
function copyNode<T extends Object3D>(source: T, made: Map<Object3D, Object3D>): T | null {
  if (!COPIED.has(source.constructor)) return null
  // The node's own `clone(false)` — the one copy of a node: pose, flags, `userData`, a mesh's
  // primitive and morphs, a sprite's centre, a light's values —, then what it shares made its own.
  const copy = source.clone(false)
  made.set(source, copy)
  copy.rotation.copy(source.rotation) // the angles as written, the quaternion following
  if (copy instanceof Mesh) {
    const worn = copy.material
    copy.geometry = copy.geometry.clone()
    copy.material = Array.isArray(worn) ? worn.map((m) => m.clone()) : worn.clone()
  }
  for (const child of source.children) {
    const inner = copyNode(child, made)
    if (inner) copy.add(inner)
  }
  return copy
}
