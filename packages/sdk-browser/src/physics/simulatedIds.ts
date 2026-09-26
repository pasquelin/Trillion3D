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
 * The ids of what a session makes in the simulation (bodies, joints, vehicles): a slot and its
 * generation, as a body's engine id (`BODY_INDEX`), moved on at every take and release, so a
 * module's report naming one that left is never read as the one that took its slot. `generation`
 * is the store the generations are kept in, one per slot.
 */
export function createSimulatedIds<T, G extends number[] | Uint8Array = number[]>(
  generation: G = [] as number[] as G,
) {
  const slots: (T | null)[] = [];
  const free: number[] = [];
  const next = (index: number) =>
    (generation[index] = ((generation[index] ?? 0) + 1) % GENERATIONS);
  return {
    generation,
    /** A fresh id for `item`. */
    take(item: T) {
      const index = free.pop() ?? slots.push(null) - 1;
      slots[index] = item;
      return index | (next(index) << GENERATION_SHIFT);
    },
    /** Frees an id: no id of its slot names anything until the slot is taken again. */
    release(id: number) {
      const index = id & BODY_INDEX;
      slots[index] = null;
      next(index);
      free.push(index);
    },
    /** What `id`'s slot holds, whatever its generation. */
    at: (id: number) => slots[id & BODY_INDEX] ?? null,
    /** What `id` names, or `null` once it left its slot. */
    of(id: number) {
      const index = id & BODY_INDEX;
      return generation[index] === id >>> GENERATION_SHIFT ? (slots[index] ?? null) : null;
    },
  };
}
