/** Bytes per texel of the uncompressed formats the engine may allocate. */
const BYTES_PER_TEXEL: Partial<Record<GPUTextureFormat, number>> = {
  r8unorm: 1,
  r8uint: 1,
  stencil8: 1,
  r16float: 2,
  r16uint: 2,
  rg8unorm: 2,
  depth16unorm: 2,
  r32float: 4,
  r32uint: 4,
  rg16float: 4,
  rg16uint: 4,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  rgba8uint: 4,
  rgb10a2unorm: 4,
  rg11b10ufloat: 4,
  depth24plus: 4,
  'depth24plus-stencil8': 4,
  depth32float: 4,
  'depth32float-stencil8': 5,
  rg32float: 8,
  rg32uint: 8,
  rgba16float: 8,
  rgba16uint: 8,
  rgba32float: 16,
  rgba32uint: 16,
}
/** Bytes per 4×4 block of the compressed formats: what T5 will allocate. */
const BYTES_PER_BLOCK: Partial<Record<GPUTextureFormat, number>> = {
  'bc1-rgba-unorm': 8,
  'bc1-rgba-unorm-srgb': 8,
  'bc4-r-unorm': 8,
  'bc3-rgba-unorm': 16,
  'bc3-rgba-unorm-srgb': 16,
  'bc5-rg-unorm': 16,
  'bc7-rgba-unorm': 16,
  'bc7-rgba-unorm-srgb': 16,
  'astc-4x4-unorm': 16,
  'astc-4x4-unorm-srgb': 16,
  'etc2-rgba8unorm': 16,
  'etc2-rgba8unorm-srgb': 16,
  'eac-rg11unorm': 16,
}

function extent(size: GPUExtent3D): [number, number, number] {
  if (Array.isArray(size)) return [size[0] ?? 1, size[1] ?? 1, size[2] ?? 1]
  const s = size as GPUExtent3DDict
  return [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1]
}

/** Bytes of a texture, every mip level included; `null` on a format outside the table. */
export function textureBytesOf(
  descriptor: Partial<GPUTextureDescriptor> & Pick<GPUTextureDescriptor, 'size' | 'format'>,
): number | null {
  const perTexel = BYTES_PER_TEXEL[descriptor.format]
  const perBlock = BYTES_PER_BLOCK[descriptor.format]
  if (perTexel === undefined && perBlock === undefined) return null
  const [width, height, depth] = extent(descriptor.size)
  const levels = descriptor.mipLevelCount ?? 1
  const volume = descriptor.dimension === '3d'
  let bytes = 0
  for (let level = 0; level < levels; level++) {
    const w = Math.max(1, width >> level),
      h = Math.max(1, height >> level),
      d = volume ? Math.max(1, depth >> level) : depth
    bytes +=
      perTexel !== undefined
        ? w * h * d * perTexel
        : Math.ceil(w / 4) * Math.ceil(h / 4) * d * perBlock!
  }
  return bytes * (descriptor.sampleCount ?? 1)
}

/** Bytes of a texture already made, from what it says of itself (`textureBytesOf`); 0 for a
 *  format outside the table, which the ledger counts as zero too. */
export const madeTextureBytes = (texture: GPUTexture) =>
  textureBytesOf({
    size: [texture.width, texture.height, texture.depthOrArrayLayers],
    format: texture.format,
    mipLevelCount: texture.mipLevelCount,
    sampleCount: texture.sampleCount,
    dimension: texture.dimension,
  }) ?? 0

/** Bytes of levels 1 and up of a `levels`-level chain: the mips beside a level 0 held elsewhere. */
export function mipTailBytes(
  width: number,
  height: number,
  format: GPUTextureFormat,
  levels: number,
): number {
  const size: GPUExtent3D = [width, height]
  return (
    textureBytesOf({ size, format, mipLevelCount: levels })! - textureBytesOf({ size, format })!
  )
}
