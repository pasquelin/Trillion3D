// What the bench knows of the sizes the engine gives: a texture's bytes (by the engine's own
// counting, `textureBytesOf`), what a view shows of it, what an attachment stores, and the threads
// of a workgroup. Read from the descriptors as the engine makes them; a size that cannot be read is
// NaN or 0, which the pass work reports as unsized.
import { mipSize } from '../../packages/math/src/scalar/integers.ts'
import { textureBytesOf } from '../../packages/sdk-browser/src/gpu/core/textureBytes.ts'

/** A texture: its bytes whole (every level), and what `viewed` needs to size a level of it. */
export type Texture = {
  bytes: number
  width: number
  height: number
  format: GPUTextureFormat
  samples: number
}
export const textures = new WeakMap<object, Texture>()
/** A view: its texture, and the bytes of the one level and layer it shows — what an attachment stores. */
export const views = new WeakMap<object, { owner: object; texture: Texture; stored: number }>()
/** The workgroup size of `entry` in WGSL `code`: its `@workgroup_size` product, each side a number or
 *  a `const` / `override` the module gives a number; 0 when one cannot be read. */
export function workgroupSize(
  code: string,
  entry: string | undefined,
  constants: Record<string, number | boolean> | undefined,
) {
  const found = [
    ...code.matchAll(/@workgroup_size\(([^)]*)\)\s*(?:@\w+(?:\([^)]*\))?\s*)*fn\s+(\w+)/g),
  ]
  const mine = found.find((f) => f[2] === entry) ?? found[0]
  if (!mine) return 0
  const side = (token: string) => {
    const text = token.trim()
    if (/^\d+u?$/.test(text)) return Number(text.replace(/u$/, ''))
    if (typeof constants?.[text] === 'number') return constants[text]
    // Only a name is looked up: an expression (`min(8, 16)`) is not a number read.
    if (!/^\w+$/.test(text)) return 0
    const named = new RegExp(
      `(?:const|override)\\s+${text}\\s*(?::\\s*\\w+)?\\s*=\\s*(\\d+)u?\\s*;`,
    ).exec(code)
    return named ? Number(named[1]) : 0
  }
  return mine[1].split(',').reduce((product, token) => product * side(token), 1)
}

/** The bytes a render pass descriptor stores in its attachments — each attachment's level, unless it
 *  is discarded or (depth) read only — and how many attachments are of a format the bench cannot size. */
export function attachmentBytes(descriptor: GPURenderPassDescriptor | undefined): [number, number] {
  let total = 0,
    unknown = 0
  const add = (view: GPUTextureView | GPUTexture) => {
    const stored = views.get(view)?.stored
    if (stored === undefined || Number.isNaN(stored)) unknown++
    else total += stored
  }
  for (const a of descriptor?.colorAttachments ?? []) if (a && a.storeOp !== 'discard') add(a.view)
  const depth = descriptor?.depthStencilAttachment
  if (depth && !depth.depthReadOnly && depth.depthStoreOp !== 'discard') add(depth.view)
  return [total, unknown]
}

/** A texture descriptor's sizes, bytes by the engine's own counting (`textureBytesOf`). */
export function describeTexture(d: GPUTextureDescriptor): Texture {
  const [width, height = 1] = Array.isArray(d.size)
    ? d.size
    : [(d.size as GPUExtent3DDict).width, (d.size as GPUExtent3DDict).height]
  return {
    bytes: textureBytesOf(d) ?? Number.NaN,
    width,
    height,
    format: d.format,
    samples: d.sampleCount ?? 1,
  }
}

/** The level a view shows, one layer: its bytes. */
export function describeView(
  owner: object,
  texture: Texture,
  d: GPUTextureViewDescriptor | undefined,
) {
  const level = d?.baseMipLevel ?? 0
  return {
    owner,
    texture,
    stored:
      textureBytesOf({
        size: [mipSize(texture.width, level), mipSize(texture.height, level), 1],
        format: texture.format,
        sampleCount: texture.samples,
      }) ?? Number.NaN,
  }
}
