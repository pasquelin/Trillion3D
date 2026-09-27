import { createSceneRoot } from '../../scene/core/root.ts';
import { releaseTransformNode } from '../../math/transform-tree/structure.ts';
import type { TransformTree } from '../../math/transform-tree/transformTree.ts';

/**
 * The transform hierarchy every scene object is a node of; a new node is a detached root of it.
 * The space holds no object: the page does, and a collected object frees its own slot, so a scene
 * loaded then dropped leaves no slot behind. A slot not yet collected costs memory only: every walk
 * costs its subtree (`links.ts`), never the space.
 */
const space = createSceneRoot({ id: 'world-objects' });
const collected = new FinalizationRegistry<[TransformTree, number]>(([tree, slot]) =>
  releaseTransformNode(tree, slot),
);

/** A slot of the space for an object about to be built. */
export const reserveSlot = () => space.reserve();

/** Frees `slot` once `object` is collected. */
export function collectSlot(object: object, slot: ReturnType<typeof reserveSlot>) {
  collected.register(object, [slot.state.tree, slot.index], object);
}

/** Withdraws `object` from collection: its slot is freed by hand (`destroy`). */
export function uncollectSlot(object: object) {
  collected.unregister(object);
}
