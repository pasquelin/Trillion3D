import {
  GEOMETRY_FORMAT,
  HISTORY_FORMATS,
  MOIRE_FORMAT,
  SHARE_FORMAT,
  resolveTargetUsage,
} from './resolve.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import type { AccumulatedImage } from '../lighting/deferred/program.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'

/** Both ping-pong histories: colour, share/flicker gradient/still weight/count, full
 *  identity/depth, and the flicker measure (`shadingHistoryWgsl.ts`), each in its format. */
export const TAA_HISTORY_BYTES_PER_PIXEL = HISTORY_FORMATS.reduce(
  (bytes, format) => bytes + 2 * texelBytesOf(format),
  0,
)

/** The temporal pass's two histories at the display's size, each a colour, its share target, its
 *  geometry and its flicker measure (`TAA_HISTORY_BYTES_PER_PIXEL`): none until `allocate`. */
export function createTaaHistoryTargets(device: GPUDevice) {
  const textures: GPUTexture[] = []
  const targets = {
    width: 0,
    height: 0,
    images: [] as AccumulatedImage[],
    geometry: [] as GPUTextureView[],
    shading: [] as GPUTextureView[],
    /** Bytes of the targets as allocated. */
    get bytes() {
      return textures.length ? targets.width * targets.height * TAA_HISTORY_BYTES_PER_PIXEL : 0
    },
    drop() {
      for (const texture of textures) texture.destroy()
      textures.length = 0
      targets.images.length = targets.geometry.length = targets.shading.length = 0
    },
    /** Makes both histories at `width × height`, the former ones dropped (`drop`). */
    allocate(width: number, height: number) {
      targets.width = width
      targets.height = height
      const usage = resolveTargetUsage(),
        size = { width, height }
      const target = (label: string, format: GPUTextureFormat) => {
        const texture = device.createTexture({ label, size, format, usage })
        textures.push(texture)
        return texture.createView()
      }
      for (let i = 0; i < 2; i++) {
        targets.geometry.push(target(`Trillion3D TAA geometry ${i}`, GEOMETRY_FORMAT))
        targets.shading.push(target(`Trillion3D TAA flicker ${i}`, MOIRE_FORMAT))
        targets.images.push({
          color: target(`Trillion3D TAA history ${i}`, HDR_FORMAT),
          share: target(`Trillion3D TAA as-is share ${i}`, SHARE_FORMAT),
        })
      }
    },
  }
  return targets
}
