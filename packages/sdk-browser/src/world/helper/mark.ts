import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** The roots the `helper` family built: marks a scene is worked on with, never its content. */
const marks = new WeakSet<Object3D>();
/** The light or camera each following helper takes its pose from (`following`, `./index.ts`). */
const targets = new WeakMap<Object3D, Object3D>();

/** Every member of `family`, its result marked as a helper: a pick and a saved scene skip it. */
export function markedFamily<T extends Record<string, (...args: never[]) => Object3D>>(family: T) {
  const wrapped: Record<string, unknown> = {};
  for (const [name, build] of Object.entries(family))
    wrapped[name] = (...args: never[]) => markHelper(build(...args));
  return wrapped as T;
}

/** Marks `node` and its subtree as a helper. */
export function markHelper<T extends Object3D>(node: T) {
  marks.add(node);
  return node;
}

/** True when `node` is the root of a helper. */
export const isHelper = (node: Object3D) => marks.has(node);

/** Names `target` as the node whose world pose the helper `node` shows. */
export function markFollowing(node: Object3D, target: Object3D) {
  targets.set(node, target);
}

/** The node whose world pose `node` shows: the light or camera a helper follows, else itself. */
export const poseSourceOf = (node: Object3D) => targets.get(node) ?? node;
