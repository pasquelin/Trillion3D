import { floorLog2 } from '../../../packages/math/src/scalar/integers.ts'
import { TEXTURE, aspectFormat, srgbPair, usageRefusedBy, type Features } from './formats.ts'

/**
 * The rules a device validates when a texture or one of its views is made, as the kit's devices
 * check them (`validation.ts`): a texture has a size, a mip chain no longer than its size allows, a
 * usage its format can hold, views in its format or its sRGB twin; a view reads a format the
 * texture lists, a usage within the texture's — inherited when it names none — that the VIEW's
 * format can hold (an sRGB view of a storage texture names its usage without storage binding:
 * inherited, the device is lost), and mips and layers the texture has.
 */

/** A texture as the rules read it — a `GPUTexture`'s own fields, its descriptor's defaults
 *  resolved, and the view formats it was made with (unknown on a texture the kit did not make). */
export type TextureInfo = {
  label?: string
  format: string
  usage: number
  width: number
  height: number
  depthOrArrayLayers: number
  mipLevelCount: number
  dimension: GPUTextureDimension
  sampleCount: number
  viewFormats?: readonly string[]
}
/** A view as the rules read it: its texture, its format, its usage and what it spans. */
export type ViewInfo = {
  texture: TextureInfo
  format: string
  usage: number
  mips: number
  layers: number
  dimension: GPUTextureViewDimension
}

const NO_FEATURES: Features = new Set<string>()

/** The levels a full chain of `info`'s size holds. */
function fullChain({ width, height, depthOrArrayLayers, dimension }: TextureInfo) {
  if (dimension === '1d') return 1
  const side = Math.max(width, height, dimension === '3d' ? depthOrArrayLayers : 1)
  return floorLog2(side) + 1
}

/** `descriptor` read as the rules read a texture, refused when the device would refuse it. */
export function checkTexture(
  descriptor: GPUTextureDescriptor,
  features: Features = NO_FEATURES,
): TextureInfo {
  const size = descriptor.size
  const [width, height = 1, layers = 1] =
    'width' in size ? [size.width, size.height, size.depthOrArrayLayers] : [...size]
  const info: TextureInfo = {
    label: descriptor.label,
    format: descriptor.format,
    usage: descriptor.usage,
    width,
    height,
    depthOrArrayLayers: layers,
    mipLevelCount: descriptor.mipLevelCount ?? 1,
    dimension: descriptor.dimension ?? '2d',
    sampleCount: descriptor.sampleCount ?? 1,
    viewFormats: [...(descriptor.viewFormats ?? [])],
  }
  const where = `[Texture "${info.label ?? ''}"] in ${info.format}`
  if (!info.usage) throw new Error(`${where}: usage is 0`)
  if (!(width > 0 && height > 0 && layers > 0))
    throw new Error(`${where}: size ${width}×${height}×${layers} has an empty side`)
  const mips = info.mipLevelCount
  if (!(mips >= 1 && mips <= fullChain(info)))
    throw new Error(`${where}: mipLevelCount ${mips} past the full chain (${fullChain(info)})`)
  const refused = usageRefusedBy(info.format, info.usage, features)
  if (refused.length)
    throw new Error(
      `${where}: its usage includes ${refused.join(', ')}, incompatible with the format`,
    )
  for (const view of info.viewFormats ?? [])
    if (!srgbPair(view, info.format))
      throw new Error(`${where}: view format ${view} differs from it by more than -srgb`)
  if (info.sampleCount > 1 && (mips > 1 || !(info.usage & TEXTURE.RENDER_ATTACHMENT)))
    throw new Error(`${where}: a multisampled texture has one mip and RenderAttachment usage`)
  if (info.sampleCount > 1 && info.usage & TEXTURE.STORAGE_BINDING)
    throw new Error(`${where}: a multisampled texture has no StorageBinding usage`)
  return info
}

/** The layers a view of each dimension spans; an array, as many as it names. */
const LAYERS_OF_DIMENSION = { '1d': 1, '2d': 1, '3d': 1, cube: 6 }

/** The view dimension a texture's views take when they name none. */
const defaultDimension = ({
  dimension,
  depthOrArrayLayers,
}: TextureInfo): GPUTextureViewDimension =>
  dimension === '2d' ? (depthOrArrayLayers > 1 ? '2d-array' : '2d') : dimension

/** The layers a texture holds for its views: a 3D texture's depth is no layer. */
const layersOf = (texture: TextureInfo) =>
  texture.dimension === '3d' ? 1 : texture.depthOrArrayLayers

/** `descriptor`'s view of `texture` as the rules read it, refused when the device would refuse it.
 *  `texture` is the kit's record of it, or a `GPUTexture` itself (its view formats then unknown). */
export function checkView(
  texture: Partial<TextureInfo> & { label?: string; format: string; usage: number },
  descriptor: GPUTextureViewDescriptor = {},
  features: Features = NO_FEATURES,
): ViewInfo {
  const whole: TextureInfo = {
    width: texture.width ?? 1,
    height: texture.height ?? 1,
    depthOrArrayLayers: texture.depthOrArrayLayers ?? 1,
    mipLevelCount: texture.mipLevelCount ?? 1,
    dimension: texture.dimension ?? '2d',
    sampleCount: texture.sampleCount ?? 1,
    label: texture.label,
    format: texture.format,
    usage: texture.usage,
    viewFormats: texture.viewFormats,
  }
  const own = aspectFormat(whole.format, descriptor.aspect)
  const format = descriptor.format ?? own,
    usage = descriptor.usage || whole.usage
  const where = `[TextureView of "${whole.label ?? ''}"] in ${format}`
  const listed = !whole.viewFormats || whole.viewFormats.includes(format)
  if (format !== own && format !== whole.format && !listed)
    throw new Error(
      `${where}: not the texture's format (${whole.format}) nor one of its viewFormats`,
    )
  if (usage & ~whole.usage) throw new Error(`${where}: usage ${usage} not within the texture's`)
  const refused = usageRefusedBy(format, usage, features)
  if (refused.length)
    throw new Error(
      `${where}: its usage includes ${refused.join(', ')}, incompatible with the format`,
    )
  const base = descriptor.baseMipLevel ?? 0,
    mips = descriptor.mipLevelCount ?? whole.mipLevelCount - base
  if (!(mips >= 1 && base + mips <= whole.mipLevelCount))
    throw new Error(`${where}: mips ${base}+${mips} past the texture's ${whole.mipLevelCount}`)
  const dimension = descriptor.dimension ?? defaultDimension(whole),
    first = descriptor.baseArrayLayer ?? 0
  const layers =
    descriptor.arrayLayerCount ??
    (dimension === 'cube' ? 6 : dimension.endsWith('array') ? layersOf(whole) - first : 1)
  if (!(layers >= 1 && first + layers <= layersOf(whole)))
    throw new Error(`${where}: layers ${first}+${layers} past the texture's ${layersOf(whole)}`)
  const counted = (LAYERS_OF_DIMENSION as Record<string, number | undefined>)[dimension]
  if ((counted && layers !== counted) || (dimension === 'cube-array' && layers % 6))
    throw new Error(`${where}: a ${dimension} view of ${layers} layers`)
  if ((dimension === '3d') !== (whole.dimension === '3d'))
    throw new Error(`${where}: a ${dimension} view of a ${whole.dimension} texture`)
  return { texture: whole, format, usage, mips, layers, dimension }
}

/** A view a render pass draws into: rendered to by its usage and its format, one mip, one layer. */
export function checkAttachment(view: ViewInfo, features: Features = NO_FEATURES) {
  const where = `[RenderPass attachment of "${view.texture.label ?? ''}"] in ${view.format}`
  if (!(view.usage & TEXTURE.RENDER_ATTACHMENT))
    throw new Error(`${where}: the view's usage ${view.usage} lacks RenderAttachment`)
  if (usageRefusedBy(view.format, TEXTURE.RENDER_ATTACHMENT, features).length)
    throw new Error(`${where}: the format is not renderable`)
  if (view.mips !== 1 || (view.dimension !== '3d' && view.layers !== 1))
    throw new Error(`${where}: a view of ${view.mips} mips and ${view.layers} layers`)
}
