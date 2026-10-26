import type {
  ResolvedLocalFogVolume,
  SceneLocalFogVolume,
} from '../../../sdk-core/src/scene/localFog/contracts.ts'
import type { SceneLocalFogStore } from '../../../sdk-core/src/scene/localFog/store.ts'
import { createNamedStoreApi, type NamedStoreApiInputs } from './namedStoreApi.ts'

/**
 * Public API of the local fog volumes (`SceneLocalFogVolume`), the shape of the fog volume objects' API
 * (`fogVolumeApi.ts`) and of the light API: the engine reads the store at the next frame
 * (`refreshFogVolumes`). A local fog volume is seen wherever the scene is — over the scene's own fog,
 * whether the scene has a fog or not.
 */
export function createExplorerLocalFogApi(inputs: NamedStoreApiInputs<SceneLocalFogStore>) {
  const api = createNamedStoreApi<SceneLocalFogVolume, ResolvedLocalFogVolume, SceneLocalFogStore>(
    inputs,
    'local fog volume',
  )
  return {
    /** The local fog volumes, in the order they were added; each a detached copy. */
    localFogVolumes: api.list,
    /** Adds a volume; a name already held is refused (`DUPLICATE_SCENE_LOCAL_FOG_VOLUME`). */
    addLocalFogVolume: api.add,
    /** Changes a volume: the fields of `patch` replace its own. */
    setLocalFogVolume: api.set,
    /** Removes a volume. */
    removeLocalFogVolume: api.remove,
  }
}
