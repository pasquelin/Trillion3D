import { retire } from '../../gpu/core/frameRetire.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { filterPrograms } from './filterPrograms.ts'
import { createBlurUniforms, WHITE } from './blurUniforms.ts'
import { BLUR_BYTES, type BLUR_EDGES } from './gaussianWgsl.ts'
import { fullscreenDraw } from './fullscreenDraw.ts'

/** The two images of a blur: the first pass's, written over the first `half` columns of a texture
 *  as wide as the image, and the second's, the blur itself (`createGaussianTargets`). */
type GaussianTargets = ReturnType<typeof createGaussianTargets>

/**
 * THE IMAGES A BLUR WRITES, `format` each, `width × height` texels: the blurs of several images of
 * one size — a bloom of each of a chain's passes, which run one after the other — share them, as
 * they share nothing else but the size. Made again when the size moves, retired with the frame
 * that may still name them.
 */
export function createGaussianTargets(device: GPUDevice, format: GPUTextureFormat, label: string) {
  let textures: GPUTexture[] = [],
    views: GPUTextureView[] = [],
    size = [0, 0],
    bytes = 0
  const release = () => {
    for (const texture of textures) retire(device, texture)
    textures = []
    views = []
    size = [0, 0]
    bytes = 0
  }
  return {
    /** The format both images are made in: the blur's programs draw in it. */
    format,
    /** The label the images, the uniforms and the draws carry. */
    label,
    /** The first pass's image, then the blur's. */
    get views() {
      return views
    },
    /** Bytes of both. */
    get bytes() {
      return bytes
    },
    /** Sizes both for an image of `width × height` texels, made again only when the size moves. */
    resize(width: number, height: number) {
      if (size[0] === width && size[1] === height) return
      release()
      size = [width, height]
      textures = [0, 1].map(() =>
        device.createTexture({
          label,
          size: { width, height },
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        }),
      )
      views = textures.map((texture) => texture.createView())
      bytes = textures.reduce((sum, texture) => sum + madeTextureBytes(texture), 0)
    },
    dispose: release,
  }
}

/** A blur stage's settings: how it takes a read past the image's edge (`BLUR_EDGES`), and the
 *  targets it writes, which carry its format and its profile label. */
type GaussianStageOptions = {
  edge: keyof typeof BLUR_EDGES
  targets: GaussianTargets
}

/**
 * THE TWO DRAWS OF A BLUR: each pass over its image with the bind group of the image it reads, the
 * second's sum adding `extra` where the stage adds one. The groups are kept while the images they
 * name and the uniforms hold; a frame makes none.
 */
function createBlurPasses(device: GPUDevice, targets: GaussianTargets) {
  const { format, label } = targets
  const programs = filterPrograms(device)
  const draw = fullscreenDraw(label)
  const identity = createWebgpuBindIdentity(1)
  let groups: GPUBindGroup[] = []
  const group = (view: GPUTextureView, uniform: GPUBuffer, added: GPUTextureView) =>
    device.createBindGroup({
      layout: programs.layouts.blur,
      entries: sequentialEntries([
        view,
        programs.clamped,
        { buffer: uniform, size: BLUR_BYTES },
        added,
      ]),
    })
  return {
    /** Draws both passes over `filter` with the passes' `uniforms`, the first over `corner` of its
     *  target, adding `extra` to the second's sum. */
    encode(
      encoder: GPUCommandEncoder,
      filter: GPUTextureView,
      extra: GPUTextureView | undefined,
      uniforms: readonly GPUBuffer[],
      corner: readonly number[],
    ) {
      const [across, result] = targets.views
      if (!uniforms.length || !result) return
      identity.next[0] = filter
      identity.next[1] = extra
      identity.next[2] = across
      identity.next[3] = uniforms[0]
      identity.next[4] = uniforms[1]
      if (identity.moved())
        groups = [
          group(filter, uniforms[0], programs.empty),
          group(across, uniforms[1], extra ?? programs.empty),
        ]
      const pipeline = programs.pipeline('blurTaps', format).get()
      draw(encoder, across, pipeline, groups[0], undefined, corner)
      draw(encoder, result, pipeline, groups[1])
    },
    /** Forgets the groups, which name resources about to be given back. */
    release() {
      groups = []
      identity.clear()
    },
  }
}

/**
 * ONE SEPARABLE GAUSSIAN BLUR: two passes over an image of `width × height` texels, along x then
 * along y, each of the kernel's reads (`gaussianKernel.ts`), the second weighting every read by a
 * tint and adding `extra`, an image of its own to the sum — the stage below this one's output, in
 * the bloom. The kernel's radius is `percent` of the width across (`gaussianRadius`). From a
 * radius of 7 texels the first pass writes half the width, in the corner of its target, which the
 * second reads bilinearly: a cheaper pass of the same blur. The stage keeps its uniforms and bind
 * groups while the size, the settings and the images it reads hold; a frame allocates none.
 */
export function createGaussianStage(device: GPUDevice, { edge, targets }: GaussianStageOptions) {
  const uniforms = createBlurUniforms(device, edge, targets.label)
  const passes = createBlurPasses(device, targets)
  return {
    /** The image the second pass writes: the blur, at the size of the image blurred. */
    get view() {
      return targets.views[1]
    },
    /**
     * Sizes the stage for an image of `width × height` texels blurred over `percent` of its width,
     * its reads weighted by `tint` in the second pass, which adds an image to its sum when `adds`;
     * its targets follow. The uniforms are written again only when the size, the percent, the
     * tint or `adds` change, the second pass's alone when the tint or `adds` did.
     */
    resize(
      width: number,
      height: number,
      percent: number,
      tint: ArrayLike<number> = WHITE,
      adds = false,
    ) {
      targets.resize(width, height)
      uniforms.resize(width, height, percent, tint, adds)
    },
    /** Draws both passes over `filter`, adding `extra` to the second's sum when the stage adds. */
    encode(encoder: GPUCommandEncoder, filter: GPUTextureView, extra?: GPUTextureView) {
      passes.encode(encoder, filter, extra, uniforms.buffers, uniforms.corner)
    },
    dispose() {
      uniforms.release()
      passes.release()
    },
  }
}
