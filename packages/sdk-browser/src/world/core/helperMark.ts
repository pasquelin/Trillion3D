import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/** The roots the `helper` family built: marks a scene is worked on with, never its content. Each is
 *  also held weakly in `held`, so a pick can name them to pass them by (`helperRoots`) and a helper
 *  dropped by the page is never kept alive for it. */
const marks = new WeakSet<Object3D>()
const held = new Set<WeakRef<Object3D>>()
/** The light or camera each following helper takes its pose from (`following`, `../api/helperFamily.ts`). */
const targets = new WeakMap<Object3D, Object3D>()

/** Every member of `family`, its result marked as a helper: a pick and a saved scene skip it. */
export function markedFamily<T extends Record<string, (...args: never[]) => Object3D>>(family: T) {
  const wrapped: Record<string, unknown> = {}
  for (const [name, build] of Object.entries(family))
    wrapped[name] = (...args: never[]) => markHelper(build(...args))
  return wrapped as T
}

/** Marks `node` and its subtree as a helper. */
export function markHelper<T extends Object3D>(node: T) {
  if (!marks.has(node)) held.add(new WeakRef(node))
  marks.add(node)
  return node
}

/** The helper roots still alive: what a pick passes by (`worldRaycast.ts`). One the page dropped
 *  leaves the list as it is read. */
export function helperRoots() {
  const roots: Object3D[] = []
  for (const ref of held) {
    const node = ref.deref()
    if (node) roots.push(node)
    else held.delete(ref)
  }
  return roots
}

/** True when `node` is the root of a helper. */
export const isHelper = (node: Object3D) => marks.has(node)

/** Names `target` as the node whose world pose the helper `node` shows. */
export function markFollowing(node: Object3D, target: Object3D) {
  targets.set(node, target)
}

/** The node whose world pose `node` shows: the light or camera a helper follows, else itself. */
export const poseSourceOf = (node: Object3D) => targets.get(node) ?? node
