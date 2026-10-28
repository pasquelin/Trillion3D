import { NEVER_SEEN } from '../../../frame/backend/state/previousCamera.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import type { Size } from '../clouds/reconstructLayout.ts'
import { LIGHT_SHAFT_FORMAT, type LightShaftSizes } from './layout.ts'

/** The usage of a history image: a target a pass draws and reads, never stores — a stored texture is
 *  never losslessly compressed on an Apple GPU (Metal's `shaderWrite`, which Dawn sets for
 *  `STORAGE_BINDING`). */
const historyUsage = () => GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING

/** History image `index` at `size`. */
const historyImage = (device: GPUDevice, size: Size, index: number) =>
  device.createTexture({
    label: `Trillion3D light shaft history ${index}`,
    size,
    format: LIGHT_SHAFT_FORMAT,
    usage: historyUsage(),
  })

/** The held image's texture in the scene's pixels: the shafts' texture size times the factor. */
const sceneBuffer = ({ shaft, factor }: LightShaftSizes): Size => ({
  width: shaft.texture.width * factor,
  height: shaft.texture.height * factor,
})

/** What the history keeps of the last image's pixels: see `createLightShaftHistory`. */
function historyState() {
  return {
    /** The image `held` describes something: a draw has been committed since the last allocation. */
    valid: false,
    /** The scene view the held image was drawn for, in the pixels the scene is drawn in. */
    viewport: { width: 0, height: 0 } as Size,
    /** The held image's texture, in the scene's pixels: the shafts' texture size times the factor. */
    buffer: { width: 0, height: 0 } as Size,
    /** The exposure scale the held image was stored at: the ratio of the next image's to it is what
     *  the held colour is multiplied by when it is read. */
    exposure: 1,
    /** The number of the image the held image was drawn for, `NEVER_SEEN` for none. */
    seen: NEVER_SEEN,
  }
}

/** Bytes the textures hold. */
const texturesBytes = (textures: readonly GPUTexture[]) =>
  textures.reduce(
    (sum, t) => sum + (textureBytesOf({ size: [t.width, t.height], format: t.format }) ?? 0),
    0,
  )

/**
 * THE HISTORY OF A LIGHT SHAFT CHAIN, a pair of images at the shafts' texture size the temporal
 * filter alternates between: it reads `held`, the last image it drew, and draws `next`; `commit`
 * after the draw swaps them, so `held` is then the filtered shafts' image the radial blur reads, and
 * the history of the next image. The occlusion has one for the view, a bloom one for each light.
 *
 * It also keeps what the last image's pixels were laid over, to read it back by: the view it was
 * drawn for, the buffer that view and the reduction make and the exposure scale the pixels were
 * stored at (`valid`, `viewport`, `buffer`, `exposure`), and the number of that image (`seen`): the view's camera of the
 * image before is its camera where `seen` is that image (`cameraSeen`), and a chain that skipped an
 * image since starts again, as after a cut. Nothing else restarts it but a first image and a change of size.
 */
export function createLightShaftHistory(device: GPUDevice) {
  const textures: GPUTexture[] = []
  const views: GPUTextureView[] = []
  let held = 0
  const history = {
    /** Bytes the two images hold. */
    get bytes() {
      return texturesBytes(textures)
    },
    ...historyState(),
    /** The last image the filter drew. */
    get held() {
      return views[held]
    },
    /** The image the filter draws into. */
    get next() {
      return views[1 - held]
    },
    /** Makes both images at `texture`, the former ones retired, none valid. */
    allocate(texture: Size) {
      history.drop()
      for (let i = 0; i < 2; i++) {
        const image = historyImage(device, texture, i)
        textures.push(image)
        views.push(image.createView())
      }
    },
    /** Keeps the images when they have the size of `texture`, else makes them. */
    fit(texture: Size) {
      if (
        textures.length &&
        textures[0].width === texture.width &&
        textures[0].height === texture.height
      )
        return
      history.allocate(texture)
    },
    /** After the draw: the image drawn becomes the held one, for the scene and the reduction
     *  `sizes` it was drawn at, stored at the exposure scale `exposure`, image number `image`. */
    commit(sizes: LightShaftSizes, exposure: number, image: number) {
      held = 1 - held
      history.valid = true
      history.seen = image
      history.exposure = exposure
      history.viewport = sizes.scene.view
      history.buffer = sceneBuffer(sizes)
    },
    /** Drops the images (this image's commands may still name them: retired), and the history. */
    drop() {
      for (const texture of textures) retire(device, texture)
      textures.length = 0
      views.length = 0
      held = 0
      history.valid = false
      history.seen = NEVER_SEEN
    },
  }
  return history
}

export type LightShaftHistory = ReturnType<typeof createLightShaftHistory>
