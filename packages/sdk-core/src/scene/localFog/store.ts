import { createNamedStore } from '../namedStore.ts'
import {
  resolveLocalFogVolume,
  sameLocalFogVolume,
  type ResolvedLocalFogVolume,
  type SceneLocalFogVolume,
} from './contracts.ts'

/** The local fog volumes of a scene (`createSceneLocalFogStore`). */
export type SceneLocalFogStore = ReturnType<typeof createSceneLocalFogStore>

/** The local fog volumes, by name (`createNamedStore`): the frame that plans them reads them again
 *  when `revision` moves. */
export const createSceneLocalFogStore = () =>
  createNamedStore<SceneLocalFogVolume, ResolvedLocalFogVolume>({
    resolve: resolveLocalFogVolume,
    same: sameLocalFogVolume,
    noun: 'local fog volume',
    duplicate: 'DUPLICATE_SCENE_LOCAL_FOG_VOLUME',
    unknown: 'UNKNOWN_SCENE_LOCAL_FOG_VOLUME',
  })
