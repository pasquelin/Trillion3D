import { createNamedStore } from '../namedStore.ts'
import { sameGraphedObject } from '../volume/objectFields.ts'
import {
  resolveHeterogeneousVolume,
  type ResolvedHeterogeneousVolume,
  type SceneHeterogeneousVolume,
} from './contracts.ts'

/** The heterogeneous volumes of a scene (`createSceneHeterogeneousVolumeStore`). */
export type SceneHeterogeneousVolumeStore = ReturnType<typeof createSceneHeterogeneousVolumeStore>

/** The heterogeneous volumes, by name (`createNamedStore`): the frame that draws them reads them
 *  again when `revision` moves. */
export const createSceneHeterogeneousVolumeStore = () =>
  createNamedStore<SceneHeterogeneousVolume, ResolvedHeterogeneousVolume>({
    resolve: resolveHeterogeneousVolume,
    same: sameGraphedObject,
    noun: 'heterogeneous volume',
    duplicate: 'DUPLICATE_SCENE_HETEROGENEOUS_VOLUME',
    unknown: 'UNKNOWN_SCENE_HETEROGENEOUS_VOLUME',
  })
