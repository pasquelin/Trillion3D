import { createNamedStore } from '../namedStore.ts'
import {
  resolvePlanarReflection,
  samePlanarReflection,
  type ResolvedPlanarReflection,
  type ScenePlanarReflection,
} from './contracts.ts'

/** The planar reflections of a scene (`createScenePlanarReflectionStore`). */
export type ScenePlanarReflectionStore = ReturnType<typeof createScenePlanarReflectionStore>

/** The planar reflections, by name (`createNamedStore`): the frame that draws them reads them again when `revision` moves. */
export const createScenePlanarReflectionStore = () =>
  createNamedStore<ScenePlanarReflection, ResolvedPlanarReflection>({
    resolve: resolvePlanarReflection,
    same: samePlanarReflection,
    noun: 'planar reflection',
    duplicate: 'DUPLICATE_SCENE_PLANAR_REFLECTION',
    unknown: 'UNKNOWN_SCENE_PLANAR_REFLECTION',
  })
