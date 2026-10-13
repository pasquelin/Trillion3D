import { EngineError } from '../../../../sdk-core/src/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { RUNTIME_MAP_BYTES_CEILING } from './runtimeMapCeiling.ts'

/** Maps borrow caller-owned bitmaps until drop/session disposal. The engine never closes them. */
export function runtimeMaps() {
  let bytes = 0
  return {
    get bytes() {
      return bytes
    },
    take(bitmap: ImageBitmap) {
      const asked = bitmap.width * bitmap.height * 4
      if (!Number.isSafeInteger(asked) || asked < 4 || bitmap.width < 1 || bitmap.height < 1)
        throw new EngineError('INVALID_MATERIAL', 'map must be a non-empty ImageBitmap', {})
      if (bytes + asked > RUNTIME_MAP_BYTES_CEILING)
        throw new EngineError('TEXTURE_BUDGET', 'runtime material maps exceed their byte ceiling', {
          held: bytes,
          asked,
          ceiling: RUNTIME_MAP_BYTES_CEILING,
        })
      bytes += asked
      const texture = new Texture(bitmap)
      texture.flipY = false
      let dropped = false
      return {
        texture,
        release() {
          if (dropped) return
          dropped = true
          bytes -= asked
          texture.image = null
          texture.dispose()
        },
      }
    },
  }
}
