import { retire } from '../../../gpu/core/frameRetire.ts'
import { DEPTH_RANGE_USAGE, depthRangeSizes } from './depthRange.ts'
import { emptySpaceTableSlot } from './emptySpace.ts'
import { CLOUD_FORMAT, type ImageSize, type Size } from './reconstructLayout.ts'
import { createCloudViewState } from './reconstruct.ts'
import { CLOUD_DEPTH_RANGE_FORMAT } from './traceWgsl.ts'

/**
 * THE IMAGES OF A VIEW'S CLOUDS, made when an image first asks for them and kept while their sizes
 * and kinds are the same: the scene's depth range (the half-size texture and, with two surfaces,
 * the quarter-size one), the traced images (the colour, the secondary colour with two surfaces, the
 * depth) and the colour a trace writes before the haze pass lays its haze over it, and the two
 * reconstructed images that take turns as the destination and the history. A texture of another
 * size or kind is made again, the one it replaces destroyed: the plan's history (`advanceCloudView`)
 * is never read of a texture that was made again, the caller asking a cut. The reconstructed image
 * with the fog laid on it, for the translucent surfaces, is one more (`fogged`).
 */

/** `GPUTextureUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8,
  RENDER_ATTACHMENT = 16

/** Bytes of a texel of the cloud images (four half floats) and of the depth range (two). */
const IMAGE_TEXEL_BYTES = 8,
  RANGE_TEXEL_BYTES = 4

/** The images of one cloud image: its colour, its secondary colour with two surfaces, its depth
 *  (`depth` is unset on an image made without one: the unhazed image's with one surface). */
export interface CloudImages {
  readonly key: string
  readonly colour: GPUTexture
  readonly secondary?: GPUTexture
  readonly depth: GPUTexture
  readonly views: {
    readonly colour: GPUTextureView
    readonly secondary?: GPUTextureView
    readonly depth: GPUTextureView
  }
  readonly bytes: number
}

/**
 * WHAT THE TRANSLUCENT SURFACES READ OF AN IMAGE OF THE CLOUDS, left by the image for the blended
 * pass: the colour image they read the cloud over a surface's fog from and the depth image (its `x`
 * the cloud's front, in kilometres), the scale from the view's screen coordinates to theirs and the
 * most they are read at, the pre-exposure the light was written with, the soft blending's length in
 * kilometres, and the image they were made for. The image is the one the composition reads, with the
 * fog laid on it where the setup asks (`CloudSetup.lateFogOnTranslucent`).
 */
export interface CloudShown {
  readonly colour: GPUTextureView
  readonly depth: GPUTextureView
  readonly uvScale: readonly [number, number]
  readonly uvMax: readonly [number, number]
  readonly preExposure: number
  readonly softBlendingKm: number
  readonly frame: number
}

/** A composition held back for a stage of the frame (`CloudViewGpu.deferred`). */
export type CloudDeferred =
  | {
      readonly stage: 'water'
      readonly compose: (water?: GPUTextureView) => void
      /** The clouds laid into the water's scene copy `target` (`width` by `height` texels, `factor` times fewer pixels a side than the image),
       *  `depth` the water pass's linear copy of the scene's depth, of the same size. */
      readonly behindWater: (
        target: GPUTextureView,
        depth: GPUTextureView,
        width: number,
        height: number,
        factor: number,
      ) => void
    }
  | { readonly stage: 'translucency'; readonly compose: () => void }

/** The scene's depth range textures: the half-size one, and the quarter-size one with two
 *  surfaces. */
export interface CloudDepthRange {
  readonly key: string
  readonly half: GPUTexture
  readonly quarter?: GPUTexture
  readonly views: { readonly half: GPUTextureView; readonly quarter?: GPUTextureView }
  readonly bytes: number
}

/** Whether an image holds a depth: always, never, or with its second surface alone (the unhazed
 *  image's depth is the closest surface's, which the haze pass reads). */
type ImageDepth = boolean | 'withSecondary'

const sizeKey = (size: Size) => `${size.width}x${size.height}`

function imagesOf(
  device: GPUDevice,
  label: string,
  size: Size,
  usage: number,
  secondary: boolean,
  depth: ImageDepth,
): CloudImages {
  const make = (name: string) =>
    device.createTexture({
      label: `Trillion3D cloud ${label} ${name}`,
      size,
      format: CLOUD_FORMAT,
      usage,
    })
  const colour = make('colour'),
    second = secondary ? make('secondary') : undefined,
    deep = depth === true || (depth === 'withSecondary' && secondary) ? make('depth') : undefined
  const count = 1 + (second ? 1 : 0) + (deep ? 1 : 0)
  return {
    key: `${sizeKey(size)}|${secondary}|${depth}`,
    colour,
    secondary: second,
    depth: deep!,
    views: {
      colour: colour.createView(),
      secondary: second?.createView(),
      depth: deep?.createView() as GPUTextureView,
    },
    bytes: size.width * size.height * IMAGE_TEXEL_BYTES * count,
  }
}

const destroyImages = (images: CloudImages | undefined) =>
  void [images?.colour, images?.secondary, images?.depth].forEach((t) => t?.destroy())

/** A place for one kind of image, `usage` its textures' flags: the images of a size and a kind are
 *  made on the first ask and kept, those of another replace them. */
function imageSlot(device: GPUDevice, label: string, usage: number, depth: ImageDepth) {
  let held: CloudImages | undefined
  return {
    get(size: Size, secondary: boolean) {
      if (held?.key !== `${sizeKey(size)}|${secondary}|${depth}`) {
        const old = held
        if (old) retire(device, { destroy: () => destroyImages(old) })
        held = imagesOf(device, label, size, usage, secondary, depth)
      }
      return held
    },
    /** The images as they stand: none before an ask. */
    get held() {
      return held
    },
    get bytes() {
      return held?.bytes ?? 0
    },
    release() {
      destroyImages(held)
      held = undefined
    },
  }
}

/** The place for the depth range textures. */
function rangeSlot(device: GPUDevice) {
  let held: CloudDepthRange | undefined
  const make = (name: string, image: ImageSize) =>
    device.createTexture({
      label: `Trillion3D cloud depth range ${name}`,
      size: image.texture,
      format: CLOUD_DEPTH_RANGE_FORMAT,
      usage: DEPTH_RANGE_USAGE,
    })
  const slot = {
    get(allocated: Size, view: Size, quarter: boolean): CloudDepthRange {
      const sizes = depthRangeSizes(allocated, view)
      const key = `${sizeKey(sizes.half.texture)}|${quarter}`
      if (held?.key === key) return held
      slot.release()
      const half = make('half', sizes.half),
        second = quarter ? make('quarter', sizes.quarter) : undefined
      const texels = (image: ImageSize) => image.texture.width * image.texture.height
      return (held = {
        key,
        half,
        quarter: second,
        views: { half: half.createView(), quarter: second?.createView() },
        bytes: RANGE_TEXEL_BYTES * (texels(sizes.half) + (quarter ? texels(sizes.quarter) : 0)),
      })
    },
    get bytes() {
      return held?.bytes ?? 0
    },
    release() {
      held?.half.destroy()
      held?.quarter?.destroy()
      held = undefined
    },
  }
  return slot
}

/** The uniform buffers and the bind groups an image of the clouds names, each by the slot of its
 *  pass: a buffer made on the first ask, a group made again where one of the objects it is made of
 *  is not the one it was made of. */
function passResources(device: GPUDevice) {
  const blocks = new Map<string, GPUBuffer>()
  const groups = new Map<string, { names: readonly unknown[]; group: GPUBindGroup }>()
  return {
    block(slot: string, floats: number): GPUBuffer {
      let buffer = blocks.get(slot)
      if (!buffer) {
        buffer = device.createBuffer({
          label: `Trillion3D cloud ${slot}`,
          size: floats * 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        blocks.set(slot, buffer)
      }
      return buffer
    },
    group(
      slot: string,
      layout: GPUBindGroupLayout,
      names: readonly unknown[],
      entries: () => GPUBindGroupEntry[],
    ): GPUBindGroup {
      const held = groups.get(slot)
      const all = [layout, ...names]
      if (held && held.names.length === all.length && all.every((n, i) => held.names[i] === n))
        return held.group
      const group = device.createBindGroup({
        label: `Trillion3D cloud ${slot}`,
        layout,
        entries: entries(),
      })
      groups.set(slot, { names: all, group })
      return group
    },
    forgetGroups: () => groups.clear(),
    destroyBlocks() {
      for (const buffer of blocks.values()) buffer.destroy()
      blocks.clear()
    },
  }
}

/** What the last image left, to tell the next whether it continues it: the camera cut it was drawn
 *  at, the allocated size, the pre-exposure its light was written with, how many images follow a cut, whether
 *  it drew, and the world's clock it was drawn at (what a wind drifts the clouds by). */
const emptyLast = () => ({
  revision: undefined as number | undefined,
  sizes: '',
  preExposure: 1,
  images: 0,
  drawn: false,
  time: undefined as number | undefined,
})

/**
 * A view's cloud images, with the reconstruction's state (`createCloudViewState`) they belong to
 * and what the last image left (`last`). `bytes` is what they hold; `release` gives every texture
 * back, `dispose` the blocks as well.
 */
export function createCloudViewGpu(device: GPUDevice) {
  const resources = passResources(device)
  const range = rangeSlot(device)
  const traced = imageSlot(device, 'traced', STORAGE_BINDING | TEXTURE_BINDING, true)
  const raw = imageSlot(device, 'unhazed', STORAGE_BINDING | TEXTURE_BINDING, 'withSecondary')
  const rebuilt = [0, 1].map((slot) =>
    imageSlot(device, `reconstructed ${slot}`, RENDER_ATTACHMENT | TEXTURE_BINDING, true),
  )
  const fogged = imageSlot(device, 'fogged', RENDER_ATTACHMENT | TEXTURE_BINDING, false)
  const holdout = imageSlot(device, 'holdout', STORAGE_BINDING | TEXTURE_BINDING, false)
  const table = emptySpaceTableSlot(device)
  const all = [range, traced, raw, ...rebuilt, fogged, holdout, table]
  return {
    state: createCloudViewState(),
    /** What the last image left for the translucent surfaces; none before an image that draws. */
    shown: undefined as CloudShown | undefined,
    /** The composition of the last image where it waits for its stage (`encodeCloudView`'s `deferred`): the single-layer
     *  water to be shaded, which gives the texture whose alpha marks the water's pixels, or, for a debug view of the
     *  tracing (`cloudDebugView`), the translucent surfaces to be drawn; none else. */
    deferred: undefined as CloudDeferred | undefined,
    last: emptyLast(),
    /** The depth range textures for a view of `view` pixels drawn in a target allocated at
     *  `allocated`; with `quarter`, the quarter-size texture of two surfaces as well. */
    depthRange: range.get,
    /** The traced images of a trace of `size` texels, with two surfaces or one. */
    traced: traced.get,
    /** The colour a trace writes before the haze pass: the traced image's, its depth that of the
     *  closest surface, with two surfaces alone. */
    raw: raw.get,
    /** The reconstructed image `slot` (0 or 1), of `size` texels. */
    reconstructed: (slot: 0 | 1, size: Size, secondary: boolean) =>
      rebuilt[slot].get(size, secondary),
    /** The reconstructed image with the fog laid on it, of `size` texels (colour alone): what the
     *  translucent surfaces read where the setup asks for it (`lateFogOnTranslucent`). */
    fogged: (size: Size) => fogged.get(size, false),
    /** The alpha holdout's coverage a trace of `size` texels writes, in the first channel: made on the first ask. */
    holdout: (size: Size) => holdout.get(size, false),
    /** The reconstructed image `slot` as it stands: none before an image made it. */
    reconstructedAt: (slot: 0 | 1) => rebuilt[slot].held,
    /** The empty-space table the tracing starts its march by, made on the first ask. */
    emptySpaceTable: table,
    /** The uniform buffer named `slot`, of `floats` floats: one for each pass that writes a block,
     *  so that two writes of an image never meet in a buffer. */
    block: resources.block,
    /** The bind group named `slot` over `layout`, made again where one of the `names` it is made
     *  of is not the object it was made of: a still view binds the same group image after image. */
    group: resources.group,
    /** Bytes of every texture held. */
    get bytes() {
      return all.reduce((sum, slot) => sum + slot.bytes, 0)
    },
    /** Every texture destroyed. */
    release() {
      for (const slot of all) slot.release()
      resources.forgetGroups()
    },
    /** Everything given back: the textures, the blocks. */
    dispose() {
      for (const slot of all) slot.release()
      resources.forgetGroups()
      resources.destroyBlocks()
    },
  }
}

export type CloudViewGpu = ReturnType<typeof createCloudViewGpu>

/** A view's clouds given back: the images, the blocks and the groups. */
export function disposeCloudView(gpu: { clouds?: CloudViewGpu }) {
  gpu.clouds?.dispose()
  gpu.clouds = undefined
}
