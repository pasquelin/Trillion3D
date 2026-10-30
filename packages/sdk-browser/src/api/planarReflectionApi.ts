import type {
  ResolvedPlanarReflection,
  ScenePlanarReflection,
} from '../../../sdk-core/src/scene/planarReflection/contracts.ts'
import type { ScenePlanarReflectionStore } from '../../../sdk-core/src/scene/planarReflection/store.ts'
import { createNamedStoreApi, requiredStore, type NamedStoreApiInputs } from './namedStoreApi.ts'

/**
 * Public API of the planar reflections (`ScenePlanarReflection`), the shape of the reflection captures' API
 * (`reflectionCaptureApi.ts`): the frame reads the store again when it changes. A read hands out copies of the numbers and the very
 * objects the reflection hides, which a copy would take apart from the scene.
 */
export function createExplorerPlanarReflectionApi(
  inputs: NamedStoreApiInputs<ScenePlanarReflectionStore>,
) {
  const api = createNamedStoreApi<
    ScenePlanarReflection,
    ResolvedPlanarReflection,
    ScenePlanarReflectionStore
  >(inputs, 'planar reflection')
  return {
    /** The planar reflections, in the order they were added; the numbers of each a detached copy. */
    planarReflections(): ResolvedPlanarReflection[] {
      inputs.check()
      return [...requiredStore(inputs.store, 'planar reflection').values].map(
        ({ hidden, ...numbers }) => ({ ...structuredClone(numbers), hidden: [...hidden] }),
      )
    },
    /** Adds a planar reflection; a name already held is refused (`DUPLICATE_SCENE_PLANAR_REFLECTION`). */
    addPlanarReflection: api.add,
    /** Changes a planar reflection: the fields of `patch` replace its own. */
    setPlanarReflection: api.set,
    /** Removes a planar reflection. */
    removePlanarReflection: api.remove,
  }
}
