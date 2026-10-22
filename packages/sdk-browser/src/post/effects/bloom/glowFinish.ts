import type { ResolvedBloomDirtMask } from '../../../../../sdk-core/src/contracts/bloomDirtOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { fullscreenDraw } from '../../filters/fullscreenDraw.ts'
import type { PostFrame } from '../../finish/finish.ts'
import { createDirtMask } from './dirtMask.ts'
import { GLOW_SHAPE, GLOW_SHAPE_BYTES } from './glowFinishWgsl.ts'
import { glowPrograms } from './glowPrograms.ts'

/** What a glow is finished with (`createGlowFinish`): the dirt mask, and the light the image gives
 *  up. */
export interface GlowFinishing {
  /** The dirt mask, drawn when it holds a picture and an intensity. */
  dirt: ResolvedBloomDirtMask
  /** The bloom's intensity, which the dirt mask's is read against. */
  intensity: number
  /** What the image is multiplied by before it is added to the glow (the convolution's tint less 1),
   *  none where the image keeps its light. */
  keep: readonly number[] | undefined
  /** Whether the composition adds the glow: the image's light is then what it multiplies. */
  fused: boolean
}

/** Whether the dirt mask is drawn: a picture, an intensity, and a glow that has one. */
export const dirtShows = (dirt: ResolvedBloomDirtMask, intensity: number) =>
  dirt.image !== undefined && dirt.intensity > 0 && intensity > 0

/** The words of the finishing's uniform (`GLOW_SHAPE`) for `finishing`, `shows` the dirt mask. */
function shapeWords(
  words: Float32Array,
  { dirt, intensity, keep, fused }: GlowFinishing,
  shows: boolean,
  size: readonly number[],
) {
  const at = GLOW_SHAPE.at
  words.fill(0)
  if (keep) {
    for (let c = 0; c < 3; c++) words[at.keep + c] = keep[c]
    words[at.keep + 3] = 1
  }
  if (shows) {
    const scale = dirt.intensity / intensity
    for (let c = 0; c < 3; c++) words[at.dirt + c] = dirt.tint[c] * scale
    words[at.dirt + 3] = 1
  }
  words[at.mode] = fused ? 1 : 0
  words[at.mode + 1] = size[0]
  words[at.mode + 2] = size[1]
}

/** The image the finished glow is drawn into, `size` texels, made again when the size moves. */
function createFinishedImage(device: GPUDevice) {
  let held: { texture: GPUTexture; view: GPUTextureView; size: readonly number[] } | undefined
  const release = () => {
    if (held) retire(device, held.texture)
    held = undefined
  }
  return {
    of(size: readonly number[]) {
      if (held && (held.size[0] !== size[0] || held.size[1] !== size[1])) release()
      if (!held) {
        const texture = device.createTexture({
          label: BLOOM_PASS,
          size: { width: size[0], height: size[1] },
          format: HDR_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        held = { texture, view: texture.createView(), size: [size[0], size[1]] }
      }
      return held.view
    },
    get bytes() {
      return held ? madeTextureBytes(held.texture) : 0
    },
    release,
  }
}

/** The finishing's group over the image, the glow and the dirt mask, kept while they hold. */
function createFinishGroups(
  device: GPUDevice,
  programs: ReturnType<typeof glowPrograms>,
  uniform: GPUBuffer,
) {
  const identity = createWebgpuBindIdentity(2),
    groups: GPUBindGroup[] = []
  return {
    of(scene: GPUTextureView, glow: GPUTextureView, picture: GPUTextureView) {
      identity.next[0] = scene
      identity.next[1] = glow
      identity.next[2] = picture
      if (identity.moved())
        groups[identity.slot] = device.createBindGroup({
          layout: programs.layout,
          entries: sequentialEntries([
            scene,
            glow,
            picture,
            programs.filters.clamped,
            { buffer: uniform, size: GLOW_SHAPE_BYTES },
          ]),
        })
      return groups[identity.slot]
    },
    clear() {
      identity.clear()
      groups.length = 0
    },
  }
}

/**
 * THE GLOW'S FINISHING (`glowFinish`, `./glowFinishWgsl.ts`): the dirt mask applied, and the light the
 * image gives up to a convolution taken from it, in an image of the picture's size that stands in
 * for the glow where either is on — a pass the glow does not otherwise need, none where neither
 * is. The blooms of a chain run one after the other, so one image serves them all, made when the
 * first asks, given back when none does.
 */
export function createGlowFinish(device: GPUDevice) {
  const programs = glowPrograms(device)
  const mask = createDirtMask(device)
  const image = createFinishedImage(device)
  const draw = fullscreenDraw(BLOOM_PASS)
  const uniform = device.createBuffer({
    label: BLOOM_PASS,
    size: GLOW_SHAPE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Float32Array(GLOW_SHAPE.words)
  const wordsImage = new Uint32Array(words.buffer)
  const groups = createFinishGroups(device, programs, uniform)
  /** The finished image and the mask given back: no glow is finished. */
  const release = () => {
    image.release()
    mask.release()
    groups.clear()
  }
  return {
    /**
     * Draws the finished glow over `scene`, an image of `size`: `glow` read at each pixel's place, the
     * dirt mask applied where `finishing` shows one, the image's light given up where it keeps
     * less. `post.layers` is the finishing's group the local gain is read from. Returns the image.
     */
    encode(
      encoder: GPUCommandEncoder,
      scene: GPUTextureView,
      glow: GPUTextureView,
      size: readonly number[],
      finishing: GlowFinishing,
      post: PostFrame,
    ) {
      const shows = dirtShows(finishing.dirt, finishing.intensity)
      const picture = shows ? mask.view(encoder, finishing.dirt.image!) : programs.filters.empty
      if (!shows) mask.release()
      shapeWords(words, finishing, shows, size)
      writeChanged(device, uniform, wordsImage, 0, wordsImage.length)
      const out = image.of(size)
      draw(encoder, out, programs.finish.get(), groups.of(scene, glow, picture), post.layers)
      return out
    },
    /** Bytes of the finished image and the mask. */
    get bytes() {
      return image.bytes + mask.bytes
    },
    release,
    dispose() {
      release()
      retire(device, uniform)
    },
  }
}
