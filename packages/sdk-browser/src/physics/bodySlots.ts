import { BODY_INDEX, GENERATION_SHIFT, GENERATIONS } from '../../../sdk-core/src/physics/index.ts';
import type { Bodied } from './bodies.ts';
import type { CookedMade } from './cookedSoft.ts';
import type { Model, Placed } from './tilePlace.ts';

/** Who holds a body slot: a page's mesh, made at its world `scale`; a cooked tile of a model; or
 *  a cooked soft body of one. */
export type SlotOwner =
  | { mesh: Bodied; scale: readonly [number, number, number] }
  | { model: Model; tile: Placed }
  | { model: Model; soft: CookedMade };

/**
 * The one owner of each body slot, read by engine id — a slot and its generation (`BODY_INDEX`),
 * moved on at every take and release —, so the id of a slot's earlier body, in a tick or a ray's
 * hit, names nothing. `meshes` is the page's column of it, by slot, for the poses.
 */
export function createBodySlots(size: number) {
  const owners: (SlotOwner | null)[] = [];
  const meshes: (Bodied | null)[] = [];
  const generation = new Uint8Array(size);
  const free: number[] = [];
  const next = (index: number) => (generation[index] = (generation[index] + 1) % GENERATIONS);
  /** What engine id `id` names, or `null` once that body left its slot. */
  const of = (id: number): SlotOwner | null => {
    const index = id & BODY_INDEX;
    return generation[index] === id >>> GENERATION_SHIFT ? (owners[index] ?? null) : null;
  };
  return {
    meshes,
    generation,
    /** A free slot held by `owner`: its engine id. */
    take(owner: SlotOwner) {
      const index = free.pop() ?? owners.push(null) - 1;
      owners[index] = owner;
      meshes[index] = 'mesh' in owner ? owner.mesh : null;
      return index | (next(index) << GENERATION_SHIFT);
    },
    /** Slot `index` given back: no id of it names anything until it is taken again. */
    release(index: number) {
      owners[index] = meshes[index] = null;
      next(index);
      free.push(index);
    },
    of,
    /** What slot `index` holds now, whatever id asks. */
    at: (index: number): SlotOwner | null => owners[index] ?? null,
    /** The mesh an engine id names, or `null`. */
    meshOf(id: number) {
      const owner = of(id);
      return owner && 'mesh' in owner ? owner.mesh : null;
    },
    /** The model a cooked tile's or soft body's engine id belongs to, or `null`. */
    modelOf(id: number) {
      const owner = of(id);
      return owner && 'model' in owner ? owner.model : null;
    },
  };
}
