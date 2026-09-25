import {
  BODY_INDEX,
  GENERATION_SHIFT,
  GENERATIONS,
  MISS,
} from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { hasBody, type createPhysicsBodies } from './bodies.ts';

/** The engine id of `node`'s body: `MISS` for no node (the world), -1 while it is not simulated. */
export function engineIdOf(bodies: ReturnType<typeof createPhysicsBodies>, node: Object3D | null) {
  if (!node) return MISS;
  const index = hasBody(node) ? node.physics._index : -1;
  if (index < 0) return -1;
  const id = index | (bodies.generation[index] << GENERATION_SHIFT);
  return bodies.meshOf(id) === node ? id : -1;
}

/**
 * The ids of what a session makes in the simulation between bodies (joints, vehicles): a slot and
 * its generation, as a body's engine id (`BODY_INDEX`), so a module's report naming one that left
 * is never read as the one that took its slot.
 */
export function createSimulatedIds<T>() {
  const slots: (T | null)[] = [];
  const generation: number[] = [];
  const free: number[] = [];
  return {
    /** A fresh id for `item`. */
    take(item: T) {
      const index = free.pop() ?? slots.push(null) - 1;
      generation[index] = ((generation[index] ?? 0) + 1) % GENERATIONS;
      slots[index] = item;
      return index | (generation[index] << GENERATION_SHIFT);
    },
    /** Frees an id. */
    release(id: number) {
      slots[id & BODY_INDEX] = null;
      free.push(id & BODY_INDEX);
    },
    /** What `id`'s slot holds, whatever its generation. */
    at: (id: number) => slots[id & BODY_INDEX] ?? null,
  };
}
