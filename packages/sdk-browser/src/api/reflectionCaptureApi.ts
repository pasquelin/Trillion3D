import type {
  ResolvedReflectionCapture,
  SceneReflectionCapture,
} from '../../../sdk-core/src/scene/reflectionCapture/contracts.ts'
import type { SceneReflectionCaptureStore } from '../../../sdk-core/src/scene/reflectionCapture/store.ts'
import { createNamedStoreApi, requiredStore, type NamedStoreApiInputs } from './namedStoreApi.ts'

/**
 * Public API of the reflection captures (`SceneReflectionCapture`), the shape of the local fog volumes' API
 * (`localFogApi.ts`): the engine reads the store at the next frame and captures again the ones that changed.
 */
export function createExplorerReflectionCaptureApi(
  inputs: NamedStoreApiInputs<SceneReflectionCaptureStore>,
) {
  const api = createNamedStoreApi<
    SceneReflectionCapture,
    ResolvedReflectionCapture,
    SceneReflectionCaptureStore
  >(inputs, 'reflection capture')
  return {
    /** The reflection captures, in the order they were added; each a detached copy. */
    reflectionCaptures: api.list,
    /** Adds a capture; a name already held is refused (`DUPLICATE_SCENE_REFLECTION_CAPTURE`). */
    addReflectionCapture: api.add,
    /** Changes a capture: the fields of `patch` replace its own. */
    setReflectionCaptureObject: api.set,
    /** Removes a capture. */
    removeReflectionCapture: api.remove,
    /** Asks every capture to be drawn again at the next images: after the scene changed. */
    recaptureReflectionCaptures() {
      inputs.check()
      requiredStore(inputs.store, 'reflection capture').recapture()
    },
  }
}
