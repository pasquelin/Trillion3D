import { retire } from '../../gpu/core/frameRetire.ts'
import { TOON_DATA_FORMATS } from './tilePass.ts'

/** The views of the toon data of a lit image: the pre-exposed diffuse light of the toon pixels, and their weights. */
export interface ToonDataViews {
  readonly diffuse: GPUTextureView
  readonly weights: GPUTextureView
}

/**
 * THE TOON DATA TARGETS of the lit image (`ContractKey.toonData`): the two targets the lights' passes add the toon pixels' unramped diffuse light and
 * their weights to (`TOON_DATA_FORMATS`), cleared with the lit image's pass and read by the step after the lights. Made at the size of the lit image's
 * target at the first image that asks, and again, the old ones retired, when that size changes.
 */
export function createToonDataTargets(device: GPUDevice) {
  let held:
    { views: ToonDataViews; width: number; height: number; textures: GPUTexture[] } | undefined
  const release = () => {
    for (const texture of held?.textures ?? []) retire(device, texture)
    held = undefined
  }
  return {
    /** The targets for a lit image target of `width` × `height` texels. */
    ensure(width: number, height: number): ToonDataViews {
      if (held && held.width === width && held.height === height) return held.views
      release()
      const make = (format: GPUTextureFormat, name: string) =>
        device.createTexture({
          label: `Trillion3D toon data ${name}`,
          size: [width, height],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
      const textures = [
        make(TOON_DATA_FORMATS.diffuse, 'diffuse'),
        make(TOON_DATA_FORMATS.weights, 'weights'),
      ]
      held = {
        width,
        height,
        textures,
        views: { diffuse: textures[0].createView(), weights: textures[1].createView() },
      }
      return held.views
    },
    release,
  }
}
