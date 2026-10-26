import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { createNamedStore } from '../../../sdk-core/src/scene/namedStore.ts'
import type { Engine } from '../session/engine/types.ts'

/** What the API of a store of named scene objects is given: the session's check that it is open, the
 *  store (none in a session without one) and the engine, told to read the store again at the next
 *  frame. */
export type NamedStoreApiInputs<Store> = {
  check: () => void
  store: Store | undefined
  engine: Engine
}

/** The store of a session, or the refusal of a session without one: `noun` names its objects. */
export function requiredStore<Store>(store: Store | undefined, noun: string): Store {
  if (!store)
    throw new EngineError('SCENE_LIGHTS_UNAVAILABLE', `session without a ${noun} store`, {})
  return store
}

/**
 * The public API of a store of named scene objects (`createNamedStore`), the shape of the light API
 * (`lightApi.ts`): the engine reads the store at the next frame (`refreshFogVolumes`). `noun` names
 * the objects in the refusal of a session without the store; a read hands out detached copies. The
 * objects voxelised into the fog's volume and the local fog volumes are this API over their own
 * stores.
 */
export function createNamedStoreApi<
  Scene extends { id: string },
  Resolved extends Scene,
  Store extends ReturnType<typeof createNamedStore<Scene, Resolved>>,
>(inputs: NamedStoreApiInputs<Store>, noun: string) {
  const { check, engine } = inputs
  const required = () => requiredStore(inputs.store, noun)
  return {
    /** The objects, in the order they were added; each a detached copy. */
    list(): Resolved[] {
      check()
      return [...required().values].map((object) => structuredClone(object))
    },
    /** Adds an object; a name already held is refused. */
    add(object: Scene) {
      check()
      required().add(object)
      engine.refreshFogVolumes()
    },
    /** Changes an object: the fields of `patch` replace its own. */
    set(id: string, patch: Partial<Omit<Scene, 'id'>>) {
      check()
      required().set(id, patch)
      engine.refreshFogVolumes()
    },
    /** Removes an object. */
    remove(id: string) {
      check()
      required().remove(id)
      engine.refreshFogVolumes()
    },
  }
}
