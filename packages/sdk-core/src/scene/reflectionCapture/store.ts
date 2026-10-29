import { createNamedStore } from '../namedStore.ts'
import {
  resolveReflectionCapture,
  sameReflectionCapture,
  type ResolvedReflectionCapture,
  type SceneReflectionCapture,
} from './contracts.ts'

/** The reflection captures of a scene (`createSceneReflectionCaptureStore`). */
export type SceneReflectionCaptureStore = ReturnType<typeof createSceneReflectionCaptureStore>

/**
 * The reflection captures, by name (`createNamedStore`): the frame that captures them reads them again when `revision` moves. Beside the
 * store's own members, `recapture()` asks every capture to be drawn again, and `recaptures` counts the asks, for the frame to see.
 */
export function createSceneReflectionCaptureStore() {
  const named = createNamedStore<SceneReflectionCapture, ResolvedReflectionCapture>({
    resolve: resolveReflectionCapture,
    same: sameReflectionCapture,
    noun: 'reflection capture',
    duplicate: 'DUPLICATE_SCENE_REFLECTION_CAPTURE',
    unknown: 'UNKNOWN_SCENE_REFLECTION_CAPTURE',
  })
  let recaptures = 0
  return Object.defineProperties(Object.create(named) as typeof named, {
    recapture: { value: () => void recaptures++ },
    recaptures: { get: () => recaptures },
  }) as typeof named & { recapture(): void; readonly recaptures: number }
}
