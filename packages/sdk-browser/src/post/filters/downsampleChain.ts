import { retire } from '../../gpu/core/frameRetire.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { DOWNSAMPLE_BYTES, DOWNSAMPLE_PARAMS } from './downsampleWgsl.ts'
import { filterPrograms } from './filterPrograms.ts'
import { fullscreenDraw } from './fullscreenDraw.ts'
import { halfSize } from './levelSizes.ts'

const AT = DOWNSAMPLE_PARAMS.at
/** The words of a level's uniform, rewritten for each: a write copies them at once. */
const words = new Float32Array(DOWNSAMPLE_PARAMS.words)

/** A level of a downsample: its image and the uniform of the pass that draws it. */
export type DownsampleLevel = {
  texture: GPUTexture
  view: GPUTextureView
  uniform: GPUBuffer
}

/** The uniform of the pass that draws a level of `size` texels from an image of `above` texels,
 *  written once: it depends on the two sizes alone. */
export function downsampleUniform(
  device: GPUDevice,
  label: string,
  size: readonly number[],
  above: readonly number[],
) {
  const uniform = device.createBuffer({
    label,
    size: DOWNSAMPLE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  words[AT.inTexel] = 1 / above[0]
  words[AT.inTexel + 1] = 1 / above[1]
  words[AT.outTexel] = 1 / size[0]
  words[AT.outTexel + 1] = 1 / size[1]
  device.queue.writeBuffer(uniform, 0, words)
  return uniform
}

/** The level of `size` texels drawn from an image of `above` texels: its image, and the uniform of
 *  its pass (`downsampleUniform`). */
export function downsampleLevel(
  device: GPUDevice,
  label: string,
  size: readonly number[],
  above: readonly number[],
): DownsampleLevel {
  const texture = device.createTexture({
    label,
    size: { width: size[0], height: size[1] },
    format: HDR_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const uniform = downsampleUniform(device, label, size, above)
  return { texture, view: texture.createView(), uniform }
}

/** The group of a downsample pass reading `above` through `uniform`. */
export const downsampleGroup = (
  device: GPUDevice,
  programs: ReturnType<typeof filterPrograms>,
  above: GPUTextureView,
  uniform: GPUBuffer,
) =>
  device.createBindGroup({
    layout: programs.layouts.down,
    entries: sequentialEntries([
      above,
      programs.clamped,
      { buffer: uniform, size: DOWNSAMPLE_BYTES },
    ]),
  })

/** Gives a level's image and uniform back, retired with the frame that may still name them. */
export function retireLevel(device: GPUDevice, { texture, uniform }: DownsampleLevel) {
  retire(device, texture)
  retire(device, uniform)
}

/** A level made by the chain: its image and what draws it from the level above. */
type Level = DownsampleLevel & {
  /** The group reading the level above, and the view it was made for. */
  group?: GPUBindGroup
  above?: GPUTextureView
}

/**
 * A CHAIN OF LEVELS, EACH THE MEAN OF THE 4 × 4 TEXELS AROUND THE ONE ABOVE IT, half its size
 * rounded up (`halveWide`, `downsampleWgsl.ts`). Level 0 is an image the caller holds, of the
 * size the chain is made for; the chain makes and draws the levels under it, up to the count a
 * frame asks for, keeps them while the size holds, and reads from the level 0 it is handed.
 */
export function createDownsampleChain(device: GPUDevice, label: string) {
  const programs = filterPrograms(device)
  const draw = fullscreenDraw(label)
  let levels: Level[] = [],
    sizes: [number, number][] = [],
    bytes = 0
  const release = () => {
    for (const level of levels) if (level) retireLevel(device, level)
    levels = []
    sizes = []
    bytes = 0
  }
  return {
    /** Bytes of the levels made. */
    get bytes() {
      return bytes
    },
    /** The size of level `at`: that of level 0 halved `at` times. */
    size: (at: number) => sizes[at],
    /** The image of level `at`, from 1; level 0 is the caller's. */
    view: (at: number) => levels[at]?.view,
    /**
     * Makes the levels 1 to `count − 1` under a level 0 of `width × height` texels, those it holds
     * kept while the size holds: a larger count adds levels, a new size makes them all again.
     */
    resize(width: number, height: number, count: number) {
      if (sizes[0]?.[0] !== width || sizes[0]?.[1] !== height) {
        release()
        sizes[0] = [width, height]
      }
      for (let at = 1; at < count; at++) {
        sizes[at] ??= halfSize(...sizes[at - 1])
        if (levels[at]) continue
        levels[at] = downsampleLevel(device, label, sizes[at], sizes[at - 1])
        bytes += madeTextureBytes(levels[at].texture)
      }
    },
    /** Draws the levels `from` to `count − 1`, the first `from` from `first`, the image of level
     *  0 when it is 1, in order. */
    encode(encoder: GPUCommandEncoder, first: GPUTextureView, count: number, from = 1) {
      const pipeline = programs.pipeline('halveWide', HDR_FORMAT).get()
      for (let at = from; at < count && levels[at]; at++) {
        const level = levels[at],
          above = at === 1 ? first : levels[at - 1].view
        if (level.above !== above) {
          level.above = above
          level.group = downsampleGroup(device, programs, above, level.uniform)
        }
        draw(encoder, level.view, pipeline, level.group!)
      }
    },
    dispose: release,
  }
}
