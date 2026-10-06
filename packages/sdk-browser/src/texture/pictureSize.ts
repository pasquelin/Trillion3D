import type { Texture } from '../../../sdk-core/src/index.ts'
import { textureRgba } from '../visibility/types.ts'
import { pictureSize } from './imageExtent.ts'

/** The size of a texture's texels: its bytes in memory, else its picture's. */
export function sourceSize(map: Texture): [number, number] {
  const rgba = textureRgba(map)
  return rgba ? [rgba.width, rgba.height] : pictureSize(map.image)
}
