import { BODY_INDEX } from '../../../sdk-core/src/physics/index.ts';
import type { Model } from './tilePlace.ts';

/**
 * Each open model's opening of the bodies it declares, one per model, `made` holding the bodies
 * made from it (`cookedBodies.ts`, `cookedSoft.ts`): a model opened again, or forgotten, gives
 * its last opening's slots back, and a read that lands after that is no longer wanted.
 */
export function createOpenings<O extends { made: { id: number }[] }>(
  release: (index: number) => void,
) {
  const held = new Map<Model, O>();
  const forget = (model: Model) => {
    held.get(model)?.made.forEach(({ id }) => release(id & BODY_INDEX));
    held.delete(model);
  };
  return {
    get: (model: Model) => held.get(model),
    values: () => held.values(),
    /** `opening` becomes `model`'s, its last one's bodies out: none held twice. */
    open(model: Model, opening: O) {
      forget(model);
      held.set(model, opening);
    },
    /** A model left the scene, or physics turned off: its bodies out. */
    forget,
    /** Whether `opening` is still `model`'s: forgotten or opened again meanwhile, it is not. */
    current: (model: Model, opening: O) => held.get(model) === opening,
    /** `made` out of `model`'s opening, its slot given back: the opening, or `undefined` when
     *  `made` was no longer in it — its slot then already given back, perhaps taken again. */
    drop(model: Model, made: O['made'][number]) {
      const opening = held.get(model);
      const at = opening?.made.indexOf(made) ?? -1;
      if (at < 0) return undefined;
      opening!.made.splice(at, 1);
      release(made.id & BODY_INDEX);
      return opening;
    },
  };
}
