import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/** True when `node` is rooted under `scene` — and, when `visibleOnly`, it and every ancestor up
 *  to the scene visible. */
export function rootedUnder(node: Object3D, scene: Object3D, visibleOnly = false) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) {
    if (visibleOnly && !walk.visible) return false
    if (walk === scene) return true
  }
  return false
}

/**
 * Whether the rows under moved `node` are drawn — the scene itself, or every ancestor visible up
 * to `scene` —, or `null` when an ancestor moved too: that one's subtree writes `node`'s rows,
 * once. One climb; a bone under a moved bone stops at its parent. The one rule of a batch of
 * moved nodes: a world's rows (`../../world/core/worldPoses.ts`) and an image's moved roots
 * (`../../webgpu/pages/render/movedBatch.ts`) each walk a moved subtree once, in its topmost
 * moved node's turn.
 */
export function chainShown(node: Object3D, scene: Object3D, moved: ReadonlySet<Object3D>) {
  let shown: boolean | undefined = node === scene || undefined
  for (let up = node.parent; up; up = up.parent) {
    if (moved.has(up)) return null
    if (shown === undefined && !up.visible) shown = false
    else if (shown === undefined && up === scene) shown = true
  }
  return shown ?? false
}
