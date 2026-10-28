import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { madeBytesOf } from '../../../gpu/core/textureBytes.ts'
import { loadOnlyUsage } from '../../../gpu/core/loadOnlyTarget.ts'
import { imageOf as sizedImageOf, type Image, type MippedImage } from '../../filters/sizedImage.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { GATHER_QUALITY, scattersOver, type Layer } from './dofConvolutions.ts'
import type { DofPlan } from './dofPlan.ts'
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

export type { Image } from '../../filters/sizedImage.ts'
/** The two tile images a range of circles is kept in: the foreground's and the background's. */
export interface TilePair {
  readonly fg: Image
  readonly bg: Image
}
/** The setup's colour and circle of confusion. */
export interface SetupImages {
  readonly color: Image
  readonly coc: Image
}
/** A layer's gathered colour and opacity, and, where it is post-filtered, the filtered ones. */
interface LayerImages {
  readonly color: Image
  readonly alpha: Image
  readonly filtered?: { readonly color: Image; readonly alpha: Image }
}

/** The usage of an image a compute pass writes, a pass reads and sprites are drawn into. */
const drawn = () => loadOnlyUsage() | GPUTextureUsage.RENDER_ATTACHMENT

/** An image of `label` of `size`, `format` and `usage`, of `mips` levels, labelled as the pass's. */
const imageOf = (
  device: GPUDevice,
  label: string,
  size: readonly number[],
  format: GPUTextureFormat,
  usage = loadOnlyUsage(),
  mips = 1,
) => sizedImageOf(device, `${DEPTH_OF_FIELD_PASS} ${label}`, size, format, usage, mips)

/** The images of one plan, made at the sizes it names. */
export interface DofImages {
  /** The setup's colour (none at a divisor of 1) and circle of confusion. */
  readonly setup: SetupImages
  /** The quarter-size copy of the setup accumulation the scatter compares against, when a layer scatters. */
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
  const color = (name: string) => imageOf(device, `${label} ${name}`, size, COLOR_FORMAT, drawn())
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

/** One of the two images the setup accumulated in time is written to. */
const stableImages = (device: GPUDevice, name: string, size: readonly number[]): SetupImages => ({
  color: imageOf(device, `accumulated colour ${name}`, size, COLOR_FORMAT),
  coc: imageOf(device, `accumulated circle ${name}`, size, COC_FORMAT),
})

/** The setup accumulated in time, two images that take turns — each image writes one and reads the
 *  other as its history; the reduction and the gather then read what the image wrote —, made at the
 *  size the accumulation is (`DofPlan.preBuffer`). One pair for each depth of field of a chain: the
 *  history is its own. */
export const makeHistory = (device: GPUDevice, plan: DofPlan) =>
  [stableImages(device, 'a', plan.preBuffer), stableImages(device, 'b', plan.preBuffer)] as const

/** The images of `plan`, at the sizes it names. */
export function makeImages(device: GPUDevice, plan: DofPlan): DofImages {
  const size = plan.buffer
  const small = [1, 1]
  const quarter = scattersOver(plan)
    ? [ceilDiv(plan.preBuffer[0], 2), ceilDiv(plan.preBuffer[1], 2)]
    : small
  const tiles = [ceilDiv(size[0], COC_TILE), ceilDiv(size[1], COC_TILE)]
  const layers: Partial<Record<Layer, LayerImages>> = {}
  for (const { layer, postfilter } of plan.convolutions)
    layers[layer] = layerImages(device, layer, size, postfilter, layer !== 'slight')
  const reduced = (name: string, format: GPUTextureFormat) =>
    imageOf(device, name, plan.reduced, format, loadOnlyUsage(), plan.mips)
  return {
    setup: {
      color: imageOf(device, 'setup colour', plan.divisor === 2 ? size : small, COLOR_FORMAT),
      coc: imageOf(device, 'setup circle', size, COC_FORMAT),
    },
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
export function makeLuts(device: GPUDevice): LutImages {
  const table = (name: string) =>
    imageOf(device, `${name} table`, [BOKEH_LUT_SIZE, BOKEH_LUT_SIZE], LUT_FORMAT)
  return { gather: table('gather'), scatter: table('scatter'), recombine: table('recombine') }
}

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
    foreground: list('foreground sprites', scattersOver(plan, 'foreground')),
    background: list('background sprites', scattersOver(plan, 'background')),
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
    set.setup.color,
    set.setup.coc,
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
  madeBytesOf([...images.map(({ texture }) => texture), ...buffers])
