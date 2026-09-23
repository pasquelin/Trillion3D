import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** The roots the `helper` family built: marks a scene is worked on with, never its content. */
const marks = new WeakSet<Object3D>();

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
