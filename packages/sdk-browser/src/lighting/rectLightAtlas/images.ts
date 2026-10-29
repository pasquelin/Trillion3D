import type { HostImage } from '../../../../sdk-core/src/contracts/hostImage.ts'
import { resolveHostImage } from '../../../../sdk-core/src/contracts/hostImage.ts'
import { refusal } from '../../../../sdk-core/src/contracts/nameMatch.ts'

/**
 * The pictures a host registered for the rectangle lights, by the id a light names them with (`SceneLight.sourceTexture`): an image
 * the engine can copy to a texture (an `ImageBitmap`, a canvas). Registering an id again with another image replaces it: the lights
 * that name it are drawn again into the atlas; the same image object registered again changes nothing. `version` rises with each change.
 */
export function createRectLightImages() {
  const held = new Map<string, HostImage>()
  let version = 0
  const refreshed = new Set<HostImage>()
  return {
    get: (id: string) => held.get(id),
    /** Registers `image` as picture `id`, or forgets the picture with `null`.
     *  @throws TypeError when `image` is not an image with a width and a height. */
    set(id: string, image: HostImage | null) {
      if (typeof id !== 'string' || !id)
        return refusal('setRectLightTexture')('the picture id must be a name')
      const next = resolveHostImage(image, refusal('setRectLightTexture'), 'the picture')
      if (held.get(id) === next) return
      if (next) held.set(id, next)
      else held.delete(id)
      version++
    },
    /** The picture `id` changed in place (a canvas drawn into, a video frame): the atlas draws it again at the next image. */
    refresh(id: string) {
      const image = held.get(id)
      if (!image) return
      refreshed.add(image)
      version++
    },
    /** The pictures refreshed since the last call, handed over once. */
    takeRefreshed() {
      const taken = [...refreshed]
      refreshed.clear()
      return taken
    },
    /** Rises with each picture registered, replaced or forgotten. */
    get version() {
      return version
    },
  }
}

/** The pictures a host registered for the rectangle lights. */
export type RectLightImages = ReturnType<typeof createRectLightImages>
