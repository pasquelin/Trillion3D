/** What every host hook shares: the revision it bumps. */
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * Revision a watch owns. Every write the host makes on the hooked pose of one of its nodes —
 * a position, a scale, a rotation — increments it at the instant of the write, so the frame
 * compares one integer instead of rereading those numbers.
 */
export interface WriteRevision {
  revision: number
  /** Told of the node written, at the instant of the write. */
  wrote(node: Object3D): void
}

/** Hook of one host node: the node, and the revisions its writes bump. Empty once every watch
 *  has left. */
export interface Hook {
  node: Object3D
  revisions: WriteRevision[]
}

export function bump(hook: Hook) {
  const list = hook.revisions
  for (let i = 0; i < list.length; i++) {
    list[i].revision++
    list[i].wrote(hook.node)
  }
}
