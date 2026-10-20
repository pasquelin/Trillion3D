import { HISTORY_FORMATS, resolveTargetUsage } from './resolve.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import type { AccumulatedImage } from '../lighting/deferred/program.ts'
import { ANALYSIS_BYTES_PER_PIXEL } from './analysis.ts'

/** Both ping-pong histories: colour, and the share target (as-is share, validity). */
const HISTORY_BYTES_PER_PIXEL = HISTORY_FORMATS.reduce(
  (bytes, format) => bytes + 2 * texelBytesOf(format),
  0,
)

/** The temporal pass's target bytes for a frame of `size`: both histories at its display size,
 *  the analysis's targets and render-resolution histories at its render size — the render targets'
 *  own, the largest a frame is drawn at, so no scale under it remakes them (`analysis.ts`). */
export const taaTargetBytes = (size: {
  width: number
  height: number
  renderWidth: number
  renderHeight: number
}) =>
  size.width * size.height * HISTORY_BYTES_PER_PIXEL +
  size.renderWidth * size.renderHeight * ANALYSIS_BYTES_PER_PIXEL

/** The temporal pass's two histories at the display's size, each a colour and its share target
 *  (`HISTORY_BYTES_PER_PIXEL`): none until `allocate`. */
export function createTaaHistoryTargets(device: GPUDevice) {
  const textures: GPUTexture[] = []
  const targets = {
    width: 0,
    height: 0,
    images: [] as AccumulatedImage[],
    /** Bytes of the targets as allocated. */
    get bytes() {
      return textures.length ? targets.width * targets.height * HISTORY_BYTES_PER_PIXEL : 0
    },
    drop() {
      // This image's commands may still name them: retired, destroyed after the frame's submit.
      for (const texture of textures) retire(device, texture)
      textures.length = 0
      targets.images.length = 0
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
        const [color, share] = HISTORY_FORMATS.map((format, k) =>
          target(`Trillion3D TAA ${k ? 'share' : 'history'} ${i}`, format),
        )
        targets.images.push({ color, share })
      }
    },
  }
  return targets
}
