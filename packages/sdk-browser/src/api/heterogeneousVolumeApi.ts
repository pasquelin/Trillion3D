import type {
  ResolvedHeterogeneousVolume,
  SceneHeterogeneousVolume,
} from '../../../sdk-core/src/scene/heterogeneousVolume/contracts.ts'
import type { SceneHeterogeneousVolumeStore } from '../../../sdk-core/src/scene/heterogeneousVolume/store.ts'
import { createNamedStoreApi, type NamedStoreApiInputs } from './namedStoreApi.ts'

/**
 * Public API of the heterogeneous volumes (`SceneHeterogeneousVolume`), the shape of the fog volume
 * API (`fogVolumeApi.ts`): the engine reads the store at the next frame. A volume reads the sparse
 * texture the compiler wrote for the node `source` of the scene.
 */
export function createExplorerHeterogeneousVolumeApi(
  inputs: NamedStoreApiInputs<SceneHeterogeneousVolumeStore>,
) {
  const api = createNamedStoreApi<
    SceneHeterogeneousVolume,
    ResolvedHeterogeneousVolume,
    SceneHeterogeneousVolumeStore
  >(inputs, 'heterogeneous volume')
  return {
    /** The heterogeneous volumes, in the order they were added; each a detached copy. */
    heterogeneousVolumes: api.list,
    /** Adds a volume; a name already held is refused (`DUPLICATE_SCENE_HETEROGENEOUS_VOLUME`). */
    addHeterogeneousVolume: api.add,
    /** Changes a volume: the fields of `patch` replace its own. */
    setHeterogeneousVolume: api.set,
    /** Removes a volume. */
    removeHeterogeneousVolume: api.remove,
  }
}
