import { Group, Object3D } from './object3d.ts';
import { Mesh } from './mesh.ts';
import { Light } from '../light/light.ts';

/** The node classes a copy builds again; any other — a loaded model, a camera — is left out. */
const COPIED = new Set<unknown>([Object3D, Group, Mesh, Light]);

/** A node of the same class and content: a mesh with a copy of its shape and materials of its
 *  own, a light with the same values and aim, a group or a bare node. */
function copyContent(source: Object3D): Object3D {
  if (source instanceof Mesh) {
    const worn = source.material;
    const matter = Array.isArray(worn) ? worn.map((m) => m.clone()) : worn.clone();
    return new Mesh(source.geometry.clone(), matter, source.primitive);
  }
  if (source instanceof Light) return source.clone(false);
  return source instanceof Group ? new Group() : new Object3D();
}

/**
 * A copy of `source` and of everything under it, sharing nothing with it: a later edit of one
 * leaves the other alone. Every field a saved scene keeps is copied — name, pose, visibility,
 * shadows, `renderOrder`, `userData` (as JSON, like a saved scene), a mesh's `primitive`, a
 * light's values. A node of a class built elsewhere (a loaded model, a camera) is not copied:
 * `null` for it, and it is left out of a copied subtree.
 */
export function cloneObject<T extends Object3D>(source: T): T | null {
  if (!COPIED.has(source.constructor)) return null;
  const copy = copyContent(source);
  copy.name = source.name;
  copy.position.copy(source.position);
  copy.rotation.copy(source.rotation); // the angles as written, the quaternion following
  copy.scale.copy(source.scale);
  copy.visible = source.visible;
  copy.castShadow = source.castShadow;
  copy.receiveShadow = source.receiveShadow;
  copy.renderOrder = source.renderOrder;
  copy.userData = JSON.parse(JSON.stringify(source.userData));
  for (const child of source.children) {
    const inner = cloneObject(child);
    if (inner) copy.add(inner);
  }
  return copy as T;
}
