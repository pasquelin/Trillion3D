import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { GATHER_QUALITY, type DofPlan, type Layer } from './dofPlan.ts'
import {
  BOKEH_LUT_SIZE,
  COC_FORMAT,
  COC_TILE,
  COLOR_FORMAT,
  DRAW_ARGUMENT_WORDS,
  LUT_FORMAT,
  SCATTER_GROUP_STRIDE,
  TILE_FORMAT,
} from './dofLayout.ts'
import { spriteCapacity } from './dofParams.ts'

/** One image: its texture and the view the passes name — every mip level of it. */
export interface Image {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}
/** An image of several mip levels, and a view of each. */
export interface MippedImage extends Image {
  readonly levels: readonly GPUTextureView[]
}
/** The two tile images a range of circles is kept in: the foreground's and the background's. */
export interface TilePair {
  readonly fg: Image
  readonly bg: Image
}
/** A layer's gathered colour and opacity, and, where it is post-filtered, the filtered ones. */
export interface LayerImages {
  readonly color: Image
  readonly alpha: Image
  readonly filtered?: { readonly color: Image; readonly alpha: Image }
}

/** The usages the images take: written by a compute pass and read, or also drawn into. */
const STORAGE = 8 /* GPUTextureUsage.STORAGE_BINDING */
const SAMPLED = 4 /* GPUTextureUsage.TEXTURE_BINDING */
const DRAWN = 16 /* GPUTextureUsage.RENDER_ATTACHMENT */

/** An image of `label` of `size`, `format` and `usage`, of `mips` levels. */
export function imageOf(
  device: GPUDevice,
  label: string,
  size: readonly number[],
  format: GPUTextureFormat,
  usage = STORAGE | SAMPLED,
  mips = 1,
): MippedImage {
  const texture = device.createTexture({
    label: `${DEPTH_OF_FIELD_PASS} ${label}`,
    size: { width: Math.max(size[0], 1), height: Math.max(size[1], 1) },
    format,
    usage,
    mipLevelCount: mips,
  })
  const levels = Array.from({ length: mips }, (_, at) =>
    texture.createView({ baseMipLevel: at, mipLevelCount: 1 }),
  )
  return { texture, view: texture.createView(), levels }
}

/** The images of one plan, made at the sizes it names. */
export interface DofImages {
  /** The setup's colour (none at a divisor of 1) and circle of confusion. */
  readonly setupColor: Image
  readonly setupCoc: Image
  /** The quarter-size copy the scatter compares against, when a layer scatters. */
  readonly quarterColor: Image
  readonly quarterCoc: Image
  /** The tiles: the flattened ones, and the two chains of dilated ones, each of two images that
   *  take turns — the minimum-maximum chain's last one is read by the other's passes. */
  readonly flat: TilePair
  readonly minMax: readonly [TilePair, TilePair]
  readonly dilated: readonly [TilePair, TilePair]
  /** The reduced setup: every mip level of the colour and of the circle. */
  readonly reducedColor: MippedImage
  readonly reducedCoc: MippedImage
  /** The layers gathered. */
  readonly layers: Partial<Record<Layer, LayerImages>>
  /** The background's occlusion, when its accumulator outputs it. */
  readonly occlusion: Image
  /** What stands for an image a pass does not use: one texel each, two colours where one pass binds
   *  two it does not use (a texture is not written twice in a dispatch). */
  readonly dummyColors: readonly [Image, Image]
  readonly dummyCoc: Image
}

/** The tile pair `label` of `size` texels. */
const tilePair = (device: GPUDevice, label: string, size: readonly number[]): TilePair => ({
  fg: imageOf(device, `${label} foreground tiles`, size, TILE_FORMAT),
  bg: imageOf(device, `${label} background tiles`, size, TILE_FORMAT),
})

/** A layer's images at the gather's buffer size; the post-filtered pair where `filtered`, no opacity
 *  where the layer outputs none. The colour is drawn into where sprites are scattered over it. */
function layerImages(
  device: GPUDevice,
  label: string,
  size: readonly number[],
  filtered: boolean,
  opacity: boolean,
): LayerImages {
  const color = (name: string) =>
    imageOf(device, `${label} ${name}`, size, COLOR_FORMAT, STORAGE | SAMPLED | DRAWN)
  const alpha = (name: string) =>
    imageOf(device, `${label} ${name}`, opacity ? size : [1, 1], COC_FORMAT)
  return {
    color: color('colour'),
    alpha: alpha('opacity'),
    ...(filtered && {
      filtered: { color: color('filtered colour'), alpha: alpha('filtered opacity') },
    }),
  }
}

/** The images that stand for what a pass does not use. */
function unusedImages(device: GPUDevice) {
  const unused = (name: string, format: GPUTextureFormat) =>
    imageOf(device, `unused ${name}`, [1, 1], format)
  return {
    dummyColors: [unused('colour a', COLOR_FORMAT), unused('colour b', COLOR_FORMAT)] as const,
    dummyCoc: unused('circle', COC_FORMAT),
  }
}

/** The images of `plan`, at the sizes it names. */
export function makeImages(device: GPUDevice, plan: DofPlan): DofImages {
  const size = plan.buffer
  const small = [1, 1]
  const scatters = plan.foregroundScatter || plan.backgroundScatter
  const quarter = scatters ? [ceilDiv(size[0], 2), ceilDiv(size[1], 2)] : small
  const tiles = [ceilDiv(size[0], COC_TILE), ceilDiv(size[1], COC_TILE)]
  const layers: Partial<Record<Layer, LayerImages>> = {}
  for (const { layer, postfilter } of plan.convolutions)
    layers[layer] = layerImages(device, layer, size, postfilter, layer !== 'slight')
  const reduced = (name: string, format: GPUTextureFormat) =>
    imageOf(device, name, plan.reduced, format, STORAGE | SAMPLED, plan.mips)
  return {
    setupColor: imageOf(device, 'setup colour', plan.divisor === 2 ? size : small, COLOR_FORMAT),
    setupCoc: imageOf(device, 'setup circle', size, COC_FORMAT),
    quarterColor: imageOf(device, 'quarter colour', quarter, COLOR_FORMAT),
    quarterCoc: imageOf(device, 'quarter circle', quarter, COC_FORMAT),
    flat: tilePair(device, 'flat', tiles),
    minMax: [
      tilePair(device, 'minimum maximum a', tiles),
      tilePair(device, 'minimum maximum b', tiles),
    ],
    dilated: [tilePair(device, 'dilated a', tiles), tilePair(device, 'dilated b', tiles)],
    reducedColor: reduced('reduced colour', COLOR_FORMAT),
    reducedCoc: reduced('reduced circle', COC_FORMAT),
    layers,
    occlusion: imageOf(
      device,
      'occlusion',
      plan.convolutions.some((c) => c.quality >= GATHER_QUALITY.occlusion) ? size : small,
      COC_FORMAT,
    ),
    ...unusedImages(device),
  }
}

/** The bokeh tables, each built once for a bokeh model. */
export interface LutImages {
  readonly gather: Image
  readonly scatter: Image
  readonly recombine: Image
}

/** The three tables' images. */
export const makeLuts = (device: GPUDevice): LutImages => ({
  gather: imageOf(device, 'gather table', [BOKEH_LUT_SIZE, BOKEH_LUT_SIZE], LUT_FORMAT),
  scatter: imageOf(device, 'scatter table', [BOKEH_LUT_SIZE, BOKEH_LUT_SIZE], LUT_FORMAT),
  recombine: imageOf(device, 'recombine table', [BOKEH_LUT_SIZE, BOKEH_LUT_SIZE], LUT_FORMAT),
})

/** The draw's arguments, both layers', and the sprite lists, made where a layer scatters; the
 *  dummy a pass binds for each it has none of. */
export interface SpriteBuffers {
  readonly drawArguments: GPUBuffer
  readonly foreground: GPUBuffer
  readonly background: GPUBuffer
}

/** The sprite buffers of `plan`: a list holds its groups and the room a last instance's unused groups
 *  take; a layer that does not scatter has the one-entry dummy. */
export function makeSpriteBuffers(device: GPUDevice, plan: DofPlan): SpriteBuffers {
  const make = (label: string, bytes: number, usage: number) =>
    device.createBuffer({ label: `${DEPTH_OF_FIELD_PASS} ${label}`, size: bytes, usage })
  const list = (label: string, scatters: boolean) =>
    make(
      label,
      scatters ? spriteCapacity(plan) * SCATTER_GROUP_STRIDE * 16 : 16,
      GPUBufferUsage.STORAGE,
    )
  return {
    drawArguments: make(
      'draw arguments',
      2 * DRAW_ARGUMENT_WORDS * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    ),
    foreground: list('foreground sprites', plan.foregroundScatter),
    background: list('background sprites', plan.backgroundScatter),
  }
}

/** Every image of a set, in a list. */
export function imagesIn(set: DofImages): Image[] {
  const layers = Object.values(set.layers).flatMap((l) => [
    l.color,
    l.alpha,
    ...(l.filtered ? [l.filtered.color, l.filtered.alpha] : []),
  ])
  const pairs = [set.flat, ...set.minMax, ...set.dilated].flatMap((p) => [p.fg, p.bg])
  return [
    set.setupColor,
    set.setupCoc,
    set.quarterColor,
    set.quarterCoc,
    ...pairs,
    set.reducedColor,
    set.reducedCoc,
    ...layers,
    set.occlusion,
    ...set.dummyColors,
    set.dummyCoc,
  ]
}

/** Bytes of a list of images and buffers as made. */
export const bytesOf = (images: readonly Image[], buffers: readonly GPUBuffer[]) =>
  images.reduce((sum, image) => sum + madeTextureBytes(image.texture), 0) +
  buffers.reduce((sum, buffer) => sum + buffer.size, 0)
