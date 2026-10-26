import { retire } from '../../../gpu/core/frameRetire.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import type { Size } from '../clouds/reconstructLayout.ts'
import { LIGHT_SHAFT_FORMAT, LIGHT_SHAFT_MASK_FORMAT, type LightShaftSizes } from './layout.ts'
import { createLightShaftHistory, type LightShaftHistory } from './temporalHistory.ts'
import { LIGHT_SHAFT_VIEW } from './wgsl.ts'
import { LIGHT_SHAFT_TEMPORAL_VIEW } from './temporalWgsl.ts'

/** The uniform of a draw takes a slot of this many bytes: the offsets of a uniform binding are
 *  multiples of the device's alignment, 256 at most on a default device. */
const SLOT_BYTES = 256
/** The floats the largest uniform of a draw holds. */
export const LIGHT_SHAFT_SLOT_FLOATS = Math.max(
  LIGHT_SHAFT_VIEW.words,
  LIGHT_SHAFT_TEMPORAL_VIEW.words,
)

/** The shafts' images a view draws at one reduction: two the chain's passes take turns in, and the
 *  occlusion mask the fog reads, all at the shafts' texture size. */
export interface LightShaftImages {
  readonly texture: Size
  readonly scratch: readonly [GPUTextureView, GPUTextureView]
  readonly mask: GPUTextureView
  readonly bytes: number
  dispose(): void
}

function makeImages(device: GPUDevice, texture: Size): LightShaftImages {
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const formats = [LIGHT_SHAFT_FORMAT, LIGHT_SHAFT_FORMAT, LIGHT_SHAFT_MASK_FORMAT]
  const made = formats.map((format, at) =>
    device.createTexture({
      label: `Trillion3D light shafts image ${at}`,
      size: texture,
      format,
      usage,
    }),
  )
  return {
    texture,
    scratch: [made[0].createView(), made[1].createView()],
    mask: made[2].createView(),
    bytes: formats.reduce(
      (sum, format) => sum + (textureBytesOf({ size: texture, format }) ?? 0),
      0,
    ),
    dispose: () => retire(device, { destroy: () => made.forEach((t) => t.destroy()) }),
  }
}

/** The uniforms of the draws of an image: a slot of one buffer for each, grown when it is full. */
function createUniformSlots(device: GPUDevice) {
  let uniforms: GPUBuffer | undefined
  let slots = 0
  return {
    /** Begins an image: its draws take the slots from the first. */
    begin: () => void (slots = 0),
    /** The next slot's uniform, `floats` written into it; the buffer and the offset to bind. */
    slot(floats: Float32Array<ArrayBuffer>) {
      if (!uniforms || (slots + 1) * SLOT_BYTES > uniforms.size) {
        if (uniforms) retire(device, uniforms)
        uniforms = device.createBuffer({
          label: 'Trillion3D light shafts uniforms',
          size: Math.max(16, 2 * (slots + 1)) * SLOT_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
      }
      const offset = slots++ * SLOT_BYTES
      device.queue.writeBuffer(uniforms, offset, floats)
      return { slot: slots - 1, buffer: uniforms, offset }
    },
    bytes: () => uniforms?.size ?? 0,
    dispose() {
      if (uniforms) retire(device, uniforms)
      uniforms = undefined
    },
  }
}

/**
 * WHAT A VIEW HOLDS OF THE LIGHT SHAFTS, on the GPU: the images the chains draw in (`LightShaftImages`,
 * made for the shafts' texture size, kept while it is that), the history of the occlusion's chain
 * and one of each light's bloom (`temporalHistory.ts`), and the uniforms of the draws of an image,
 * a slot of one buffer for each. Counted in the view's bytes; given back with `dispose`.
 */
export function createLightShaftTargets(device: GPUDevice) {
  let images: LightShaftImages | undefined
  const uniforms = createUniformSlots(device)
  const histories = new Map<string, LightShaftHistory>()
  const targets = {
    /** The images, made for `sizes` where they are not. */
    imagesFor(sizes: LightShaftSizes) {
      const { texture } = sizes.shaft
      if (images?.texture.width === texture.width && images.texture.height === texture.height)
        return images
      images?.dispose()
      return (images = makeImages(device, texture))
    },
    /** The history `key` names — `'occlusion'`, or a light's id —, at the shafts' texture size. */
    history(key: string, sizes: LightShaftSizes) {
      let history = histories.get(key)
      if (!history) histories.set(key, (history = createLightShaftHistory(device)))
      history.fit(sizes.shaft.texture)
      return history
    },
    /** Lets go of the histories of the lights `kept` leaves out: a light gone takes its own. */
    keepHistories(kept: ReadonlySet<string>) {
      for (const [key, history] of histories)
        if (key !== 'occlusion' && !kept.has(key)) {
          history.drop()
          histories.delete(key)
        }
    },
    begin: uniforms.begin,
    slot: uniforms.slot,
    /** Bytes the images, the histories and the uniforms hold. */
    get bytes() {
      let bytes = (images?.bytes ?? 0) + uniforms.bytes()
      for (const history of histories.values()) bytes += history.bytes
      return bytes
    },
    dispose() {
      images?.dispose()
      images = undefined
      uniforms.dispose()
      for (const history of histories.values()) history.drop()
      histories.clear()
    },
  }
  return targets
}

export type LightShaftTargets = ReturnType<typeof createLightShaftTargets>
