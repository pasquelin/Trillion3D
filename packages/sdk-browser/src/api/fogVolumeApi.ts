import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type {
  ResolvedFogVolume,
  SceneFogVolume,
} from '../../../sdk-core/src/scene/volume/contracts.ts'
import type { SceneFogVolumeStore } from '../../../sdk-core/src/scene/volume/store.ts'
import type { Engine } from '../session/engine/types.ts'

type Inputs = {
  check: () => void
  store: SceneFogVolumeStore | undefined
  engine: Engine
}

/** A detached copy of a held object: arrays and material included. */
const copyOf = (volume: ResolvedFogVolume): ResolvedFogVolume => ({
  ...volume,
  matrix: [...volume.matrix],
  boundsMin: [...volume.boundsMin],
  boundsMax: [...volume.boundsMax],
  material: {
    ...volume.material,
    albedo: [...volume.material.albedo],
    emissive: [...volume.material.emissive],
  },
})

/**
 * Public API of the objects voxelised into the fog's volume (`SceneFogVolume`), the shape of the
 * light API (`lightApi.ts`): the engine reads the store at the next frame (`refreshFogVolumes`).
 * They add to the medium of a scene whose fog has a volume (the sky module's `heightFog.volumetric`) and are seen
 * nowhere else.
 */
export function createExplorerFogVolumeApi(inputs: Inputs) {
  const { check, engine } = inputs
  const required = () => {
    if (!inputs.store)
      throw new EngineError('SCENE_LIGHTS_UNAVAILABLE', 'session without a fog volume store', {})
    return inputs.store
  }
  return {
    /** The objects voxelised into the volume, in the order they were added; each a detached copy. */
    fogVolumes(): ResolvedFogVolume[] {
      check()
      return [...required().values].map(copyOf)
    },
    /** Adds an object; a name already held is refused (`DUPLICATE_SCENE_FOG_VOLUME`). */
    addFogVolume(volume: SceneFogVolume) {
      check()
      required().add(volume)
      engine.refreshFogVolumes()
    },
    /** Changes an object: the fields of `patch` replace its own, a `material` as a whole. */
    setFogVolume(id: string, patch: Partial<Omit<SceneFogVolume, 'id'>>) {
      check()
      required().set(id, patch)
      engine.refreshFogVolumes()
    },
    /** Removes an object. */
    removeFogVolume(id: string) {
      check()
      required().remove(id)
      engine.refreshFogVolumes()
    },
  }
}
