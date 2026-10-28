import { createNamedStore } from '../namedStore.ts'
import { resolveFogVolume, type SceneFogVolume } from './contracts.ts'
import { sameGraphedObject } from './objectFields.ts'
import type { ResolvedFogVolume } from './contracts.ts'

/** The volume objects of a scene (`createSceneFogVolumeStore`). */
export type SceneFogVolumeStore = ReturnType<typeof createSceneFogVolumeStore>

/** The objects voxelised into the fog's volume, by name (`createNamedStore`): the frame that
 *  voxelises them reads them again when `revision` moves. */
export const createSceneFogVolumeStore = () =>
  createNamedStore<SceneFogVolume, ResolvedFogVolume>({
    resolve: resolveFogVolume,
    same: sameGraphedObject,
    noun: 'fog volume',
    duplicate: 'DUPLICATE_SCENE_FOG_VOLUME',
    unknown: 'UNKNOWN_SCENE_FOG_VOLUME',
  })
