import type {
  ResolvedFogVolume,
  SceneFogVolume,
} from '../../../sdk-core/src/scene/volume/contracts.ts'
import type { SceneFogVolumeStore } from '../../../sdk-core/src/scene/volume/store.ts'
import { createNamedStoreApi, type NamedStoreApiInputs } from './namedStoreApi.ts'

/**
 * Public API of the objects voxelised into the fog's volume (`SceneFogVolume`), the shape of the
 * light API (`lightApi.ts`): the engine reads the store at the next frame (`refreshFogVolumes`).
 * They add to the medium of a scene whose fog has a volume (the sky module's `heightFog.volumetric`) and are seen
 * nowhere else.
 */
export function createExplorerFogVolumeApi(inputs: NamedStoreApiInputs<SceneFogVolumeStore>) {
  const api = createNamedStoreApi<SceneFogVolume, ResolvedFogVolume, SceneFogVolumeStore>(
    inputs,
    'fog volume',
  )
  return {
    /** The objects voxelised into the volume, in the order they were added; each a detached copy. */
    fogVolumes: api.list,
    /** Adds an object; a name already held is refused (`DUPLICATE_SCENE_FOG_VOLUME`). */
    addFogVolume: api.add,
    /** Changes an object: the fields of `patch` replace its own, a `material` as a whole. */
    setFogVolume: api.set,
    /** Removes an object. */
    removeFogVolume: api.remove,
  }
}
