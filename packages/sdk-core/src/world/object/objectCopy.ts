import type { Object3D } from './object3d.ts';

/** `Object3D.copy`: writes `source`'s name, pose, matrices and flags into `into`, and a `clone` of
 *  each of its children unless told not to — each child keeps its own class. The values are the
 *  reference's; `userData` is copied as JSON, as a saved scene keeps it. */
export function copyObject<T extends Object3D>(into: T, source: Object3D, recursive: boolean): T {
  if (source === into) return into;
  into.name = source.name;
  into.up.copy(source.up);
  into.position.copy(source.position);
  into.rotation.order = source.rotation.order;
  into.quaternion.copy(source.quaternion);
  into.scale.copy(source.scale);
  into.matrix.copy(source.matrix);
  into.matrixWorld.copy(source.matrixWorld);
  into.matrixAutoUpdate = source.matrixAutoUpdate;
  into.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
  into.visible = source.visible;
  into.castShadow = source.castShadow;
  into.receiveShadow = source.receiveShadow;
  into.frustumCulled = source.frustumCulled;
  into.renderOrder = source.renderOrder;
  into.userData = JSON.parse(JSON.stringify(source.userData)) as Record<string, unknown>;
  if (recursive) for (const child of source.children) into.add(child.clone());
  return into;
}
