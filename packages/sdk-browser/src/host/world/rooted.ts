import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** True when `node` is rooted under `scene` — and, when `visibleOnly`, it and every ancestor up
 *  to the scene visible. */
export function rootedUnder(node: Object3D, scene: Object3D, visibleOnly = false) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) {
    if (visibleOnly && !walk.visible) return false;
    if (walk === scene) return true;
  }
  return false;
}
