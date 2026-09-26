import { BODY_INDEX, type ObjectPhysics } from '../../../sdk-core/src/physics/index.ts';
import type { Bodied } from './bodies.ts';
import type { CookedMade } from './cookedSoft.ts';
import { createSimulatedIds } from './simulatedIds.ts';
import type { Model, Placed } from './tilePlace.ts';

/** Who holds a body slot: a page's mesh with the `physics` it was made with, a soft one at its
 *  world `scale`; a cooked tile of a model; or a cooked soft body of one. */
export type SlotOwner =
  | { mesh: Bodied; physics: ObjectPhysics; scale?: readonly [number, number, number] }
  | { model: Model; tile: Placed }
  | { model: Model; soft: CookedMade };

/**
 * The one owner of each body slot, read by engine id (`createSimulatedIds`), so the id of a slot's
 * earlier body, in a tick or a ray's hit, names nothing. `meshes` is the page's column of it, by
 * slot, for the poses.
 */
export function createBodySlots(size: number) {
  const ids = createSimulatedIds<SlotOwner, Uint8Array>(new Uint8Array(size));
  const meshes: (Bodied | null)[] = [];
  const { of } = ids;
  return {
    meshes,
    generation: ids.generation,
    /** A free slot held by `owner`: its engine id. */
    take(owner: SlotOwner) {
      const id = ids.take(owner);
      meshes[id & BODY_INDEX] = 'mesh' in owner ? owner.mesh : null;
      return id;
    },
    /** Slot `index` given back: no id of it names anything until it is taken again. */
    release(index: number) {
      ids.release(index);
      meshes[index] = null;
    },
    of,
    /** What slot `index` holds now, whatever id asks. */
    at: ids.at,
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
