import { BUFFER, TEXTURE, srgbPair } from './formats.ts'
import type { TextureInfo } from './textureRules.ts'

/**
 * The rules a device validates when a buffer is made, written or copied, and when a copy reads or
 * writes a texture, as the kit's devices check them (`validation.ts`): a mapped buffer copies
 * only (MAP_READ beside COPY_DST alone, MAP_WRITE beside COPY_SRC alone), a buffer mapped at
 * creation is a whole number of words, a copy's source holds COPY_SRC and its destination
 * COPY_DST, offsets and sizes are words, a texture's rows in a buffer are 256-byte aligned. A
 * resource the kit did not make (a test's own) is `undefined` here: only its numbers are checked.
 */

export type BufferInfo = { label?: string; size: number; usage: number }

const name = (info: { label?: string } | undefined) => `"${info?.label ?? ''}"`

/** `descriptor` read as the rules read a buffer, refused when the device would refuse it. */
export function checkBuffer(descriptor: GPUBufferDescriptor): BufferInfo {
  const { label, size, usage } = descriptor
  const where = `[Buffer ${name(descriptor)}]`
  if (!usage) throw new Error(`${where}: usage is 0`)
  if (!(Number.isFinite(size) && size >= 0)) throw new Error(`${where}: size ${size}`)
  if (descriptor.mappedAtCreation && size % 4)
    throw new Error(`${where}: mappedAtCreation with a size of ${size}, not a multiple of 4`)
  if (usage & BUFFER.MAP_READ && usage & ~(BUFFER.MAP_READ | BUFFER.COPY_DST))
    throw new Error(`${where}: usage ${usage} has MapRead beside more than CopyDst`)
  if (usage & BUFFER.MAP_WRITE && usage & ~(BUFFER.MAP_WRITE | BUFFER.COPY_SRC))
    throw new Error(`${where}: usage ${usage} has MapWrite beside more than CopySrc`)
  return { label, size, usage }
}

/** `buffer`'s usage holds `flag`, by the name the device gives it. */
function needs(where: string, info: { usage: number } | undefined, flag: number, word: string) {
  if (info && !(info.usage & flag)) throw new Error(`${where}: usage ${info.usage} lacks ${word}`)
}

/** Each of `numbers` a whole number of 4-byte words. */
function words(where: string, numbers: Record<string, number>) {
  for (const [key, value] of Object.entries(numbers))
    if (value % 4) throw new Error(`${where}: ${key} ${value} is not a multiple of 4`)
}

/** `[offset, offset + size)` within `info`. */
function within(where: string, info: BufferInfo | undefined, offset: number, size: number) {
  if (info && offset + size > info.size)
    throw new Error(`${where}: ${offset}+${size} past the buffer's ${info.size} bytes`)
}

export function checkCopyBuffers(
  from: BufferInfo | undefined,
  fromOffset: number,
  to: BufferInfo | undefined,
  toOffset: number,
  size: number,
) {
  const where = `[CopyBufferToBuffer ${name(from)} -> ${name(to)}]`
  needs(where, from, BUFFER.COPY_SRC, 'CopySrc')
  needs(where, to, BUFFER.COPY_DST, 'CopyDst')
  words(where, { 'source offset': fromOffset, 'destination offset': toOffset, size })
  within(where, from, fromOffset, size)
  within(where, to, toOffset, size)
  if (from && from === to) throw new Error(`${where}: a buffer copied onto itself`)
}

export function checkClear(info: BufferInfo | undefined, offset: number, size?: number) {
  const where = `[ClearBuffer ${name(info)}]`
  needs(where, info, BUFFER.COPY_DST, 'CopyDst')
  const length = size ?? (info ? info.size - offset : 0)
  words(where, { offset, size: length })
  within(where, info, offset, length)
}

export function checkWriteBuffer(info: BufferInfo | undefined, offset: number, bytes: number) {
  const where = `[WriteBuffer ${name(info)}]`
  needs(where, info, BUFFER.COPY_DST, 'CopyDst')
  words(where, { offset, size: bytes })
  within(where, info, offset, bytes)
}

/** A texture written by the queue (`writeTexture`), or by an image (`copyExternalImageToTexture`,
 *  which renders into it too). */
export function checkTextureWrite(texture: TextureInfo | undefined, external = false) {
  const where = `[${external ? 'CopyExternalImageToTexture' : 'WriteTexture'} ${name(texture)}]`
  needs(where, texture, TEXTURE.COPY_DST, 'CopyDst')
  if (external) needs(where, texture, TEXTURE.RENDER_ATTACHMENT, 'RenderAttachment')
}

/** The rows a copy moves between a buffer and a texture, by the size it copies. */
const rowsOf = (size: GPUExtent3D | undefined) => {
  if (!size || typeof size !== 'object') return { height: 1, layers: 1 }
  const [, height = 1, layers = 1] =
    'width' in size ? [size.width, size.height, size.depthOrArrayLayers] : [...size]
  return { height, layers }
}

/** A copy between a texture and a buffer: `toBuffer` reads the texture into the buffer. */
export function checkTextureBufferCopy(
  texture: TextureInfo | undefined,
  buffer: BufferInfo | undefined,
  layout: GPUTexelCopyBufferLayout,
  size: GPUExtent3D,
  toBuffer: boolean,
) {
  const kind = toBuffer ? 'CopyTextureToBuffer' : 'CopyBufferToTexture'
  const where = `[${kind} ${name(toBuffer ? texture : buffer)} -> ${name(toBuffer ? buffer : texture)}]`
  needs(
    where,
    texture,
    toBuffer ? TEXTURE.COPY_SRC : TEXTURE.COPY_DST,
    toBuffer ? 'CopySrc' : 'CopyDst',
  )
  needs(
    where,
    buffer,
    toBuffer ? BUFFER.COPY_DST : BUFFER.COPY_SRC,
    toBuffer ? 'CopyDst' : 'CopySrc',
  )
  const { height, layers } = rowsOf(size)
  const perRow = layout.bytesPerRow
  if (perRow === undefined && (height > 1 || layers > 1))
    throw new Error(`${where}: bytesPerRow missing for ${height} rows × ${layers} layers`)
  if (perRow !== undefined && perRow % 256)
    throw new Error(`${where}: bytesPerRow ${perRow} is not a multiple of 256`)
}

export function checkCopyTextures(from: TextureInfo | undefined, to: TextureInfo | undefined) {
  const where = `[CopyTextureToTexture ${name(from)} -> ${name(to)}]`
  needs(where, from, TEXTURE.COPY_SRC, 'CopySrc')
  needs(where, to, TEXTURE.COPY_DST, 'CopyDst')
  if (from && to && !srgbPair(from.format, to.format))
    throw new Error(`${where}: ${from.format} and ${to.format} do not copy into one another`)
}

/** A query set resolved into a buffer: QUERY_RESOLVE in its usage, at a 256-byte offset. */
export function checkResolve(info: BufferInfo | undefined, offset: number) {
  const where = `[ResolveQuerySet into ${name(info)}]`
  needs(where, info, BUFFER.QUERY_RESOLVE, 'QueryResolve')
  if (offset % 256) throw new Error(`${where}: offset ${offset} is not a multiple of 256`)
}
