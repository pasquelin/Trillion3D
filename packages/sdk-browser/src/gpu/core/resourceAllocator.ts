import { textureBytesOf } from './textureBytes.ts'

/** What a buffer is for: written by the kernels and the host (`storage`), the uniform, the indirect arguments the kernels
 *  write, a list the kernels fill and dispatches are made over, and the head that empties it. */
export type BufferKind = 'storage' | 'uniform' | 'args' | 'list' | 'head'

/** What a texture is made as, beside its size and format: its usage (sampled and storage by default) and its dimension (2D). */
export interface TextureOptions {
  usage?: GPUTextureUsageFlags
  dimension?: '2d' | '3d'
  /** The samples a texel holds (a multisampled attachment); 1 by default. */
  sampleCount?: 1 | 4
}

/**
 * WHERE THE RESOURCES OF A VIEW COME FROM, the one way a view names what it holds: GPU objects (`gpuAllocator`), or none,
 * counting what they would hold (`countingAllocator`). A view written once over an allocator asks its bytes of the counting
 * one and makes its resources with the other, so that the bytes it asks the device's budget for (`ledgerAdmitted`) are the
 * allocations themselves and cannot drift from them.
 *
 * THE RESTRICTION: the counting allocator makes nothing, so what it hands back is no resource (the views and buffers it returns
 * are placeholders). A builder written over an allocator only names the resources — keeps them in its result, passes them on —
 * and never touches one (no `createView`, no size read, no bind group made over it): its bytes are counted first, over the
 * placeholders. Whatever needs the resources made is done after the allocator returned, over its result.
 */
export interface ResourceAllocator {
  texture(
    label: string,
    size: readonly number[],
    format: GPUTextureFormat,
    options?: TextureOptions,
  ): GPUTextureView
  /** A texture of `levels` mip levels: a view of all of them, and a view of each alone (to be written, or read by the next level). */
  mipped(
    label: string,
    size: readonly number[],
    format: GPUTextureFormat,
    levels: number,
  ): { all: GPUTextureView; levels: GPUTextureView[] }
  /** A buffer of `words` 32-bit words for `kind`, with the usage `also` adds to the kind's (a proof reads it back with
   *  `COPY_SRC`). */
  buffer(label: string, words: number, kind: BufferKind, also?: GPUBufferUsageFlags): GPUBuffer
  /** A texture of its own, as `texture` makes it, for a user that needs the texture itself (a copy, a view of a
   *  layer), not only a view of it. */
  image(
    label: string,
    size: readonly number[],
    format: GPUTextureFormat,
    options?: TextureOptions,
  ): GPUTexture
}

/** The usage of a buffer of `kind`. */
const usageOf = (kind: BufferKind) => {
  const { STORAGE, UNIFORM, INDIRECT, COPY_DST, COPY_SRC } = GPUBufferUsage
  if (kind === 'uniform') return UNIFORM | COPY_DST
  if (kind === 'args') return STORAGE | INDIRECT
  if (kind === 'list') return STORAGE | INDIRECT | COPY_DST
  if (kind === 'head') return COPY_SRC | COPY_DST
  return STORAGE | COPY_DST
}

/** The descriptor of a texture asked of an allocator: its dimension, a size of three counts a volume, its mip levels. */
const descriptorOf = (
  size: readonly number[],
  format: GPUTextureFormat,
  { dimension = '2d', sampleCount = 1 }: TextureOptions,
  mipLevelCount = 1,
) => ({ size: [...size], format, dimension, mipLevelCount, sampleCount })

/** The bytes of a buffer of `words` 32-bit words: never under a vector's. */
const bufferBytes = (words: number) => Math.max(16, words * 4)

/** A view of all the levels of `texture`, and a view of each alone. */
const mipViews = (texture: GPUTexture, levels: number) => ({
  all: texture.createView(),
  levels: Array.from({ length: levels }, (_, level) =>
    texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
  ),
})

/** The allocator over `device`: textures (sampled and storage unless told otherwise) and buffers as asked, named with `label`
 *  first, all counted and kept to be destroyed together. */
export function gpuAllocator(device: GPUDevice, label: string) {
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
  const made: { destroy(): void }[] = []
  let bytes = 0
  const make = (
    name: string,
    size: readonly number[],
    format: GPUTextureFormat,
    options: TextureOptions,
    levels = 1,
  ) => {
    const descriptor = descriptorOf(size, format, options, levels)
    const created = device.createTexture({
      label: `${label} ${name}`,
      ...descriptor,
      usage: options.usage ?? usage,
    })
    made.push(created)
    bytes += textureBytesOf(descriptor) ?? 0
    return created
  }
  return {
    texture(
      name: string,
      size: readonly number[],
      format: GPUTextureFormat,
      options: TextureOptions = {},
    ) {
      return make(name, size, format, options).createView()
    },
    mipped(name: string, size: readonly number[], format: GPUTextureFormat, levels: number) {
      return mipViews(make(name, size, format, {}, levels), levels)
    },
    image(
      name: string,
      size: readonly number[],
      format: GPUTextureFormat,
      options: TextureOptions = {},
    ) {
      return make(name, size, format, options)
    },
    buffer(name: string, words: number, kind: BufferKind, also = 0) {
      const size = bufferBytes(words)
      const created = device.createBuffer({
        label: `${label} ${name}`,
        size,
        usage: usageOf(kind) | also,
      })
      made.push(created)
      bytes += size
      return created
    },
    /** Bytes of all that was made. */
    bytes: () => bytes,
    destroy() {
      for (const resource of made) resource.destroy()
    },
  } satisfies ResourceAllocator & { bytes(): number; destroy(): void }
}

/** The allocator that makes nothing and counts what it is asked. */
export function countingAllocator() {
  let bytes = 0
  return {
    texture(
      _name: string,
      size: readonly number[],
      format: GPUTextureFormat,
      options: TextureOptions = {},
    ) {
      bytes += textureBytesOf(descriptorOf(size, format, options)) ?? 0
      return undefined as unknown as GPUTextureView
    },
    mipped(_name: string, size: readonly number[], format: GPUTextureFormat, levels: number) {
      bytes += textureBytesOf(descriptorOf(size, format, {}, levels)) ?? 0
      const none = undefined as unknown as GPUTextureView
      return { all: none, levels: Array.from({ length: levels }, () => none) }
    },
    image(
      _name: string,
      size: readonly number[],
      format: GPUTextureFormat,
      options: TextureOptions = {},
    ) {
      bytes += textureBytesOf(descriptorOf(size, format, options)) ?? 0
      return undefined as unknown as GPUTexture
    },
    buffer(_name: string, words: number) {
      bytes += bufferBytes(words)
      return undefined as unknown as GPUBuffer
    },
    bytes: () => bytes,
  } satisfies ResourceAllocator & { bytes(): number }
}
