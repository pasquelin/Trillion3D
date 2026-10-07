/**
 * The texture formats as core WebGPU classes them, for the kit's validation (`validation.ts`): which
 * a shader stores to, which a pass renders to, which hold depth, and which views a format allows.
 * The spec's usage and stage numbers, as the rules read them whatever a test installed.
 */

/** `GPUBufferUsage`. */
export const BUFFER = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  UNIFORM: 64,
  STORAGE: 128,
  QUERY_RESOLVE: 512,
} as const
/** `GPUTextureUsage`. */
export const TEXTURE = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
} as const

/** The features a device holds, as the rules ask about them. */
export type Features = { has(name: string): boolean }

const set = (names: string) => new Set(names.trim().split(/\s+/))

/** The formats core WebGPU stores to (write-only or read-only access). */
export const STORAGE_FORMATS = set(
  'rgba8unorm rgba8snorm rgba8uint rgba8sint rgba16uint rgba16sint rgba16float r32uint r32sint ' +
    'r32float rg32uint rg32sint rg32float rgba32uint rgba32sint rgba32float bgra8unorm',
)
/** The formats core WebGPU reads and writes in one binding. */
export const READ_WRITE_FORMATS = set('r32uint r32sint r32float')

/** The depth and stencil formats: sampled or rendered, never stored to. */
export const DEPTH_FORMATS = set(
  'stencil8 depth16unorm depth24plus depth24plus-stencil8 depth32float depth32float-stencil8',
)
/** The colour formats a pass renders to; `rg11b10ufloat` only with its feature. */
const RENDERABLE_COLOR = set(
  'r8unorm r8uint r8sint rg8unorm rg8uint rg8sint rgba8unorm rgba8unorm-srgb rgba8uint rgba8sint ' +
    'bgra8unorm bgra8unorm-srgb r16uint r16sint r16float rg16uint rg16sint rg16float rgba16uint ' +
    'rgba16sint rgba16float r32uint r32sint r32float rg32uint rg32sint rg32float rgba32uint ' +
    'rgba32sint rgba32float rgb10a2uint rgb10a2unorm',
)

export const isStorage = (format: string) => STORAGE_FORMATS.has(format)

export const isRenderable = (format: string, features: Features) =>
  RENDERABLE_COLOR.has(format) ||
  DEPTH_FORMATS.has(format) ||
  (format === 'rg11b10ufloat' && features.has('rg11b10ufloat-renderable'))

/** The format a view of one aspect of `format` reads, when that aspect is a format of its own. */
export function aspectFormat(format: string, aspect: GPUTextureAspect = 'all') {
  if (aspect === 'stencil-only' && format.includes('stencil8')) return 'stencil8'
  if (aspect === 'depth-only' && format === 'depth24plus-stencil8') return 'depth24plus'
  if (aspect === 'depth-only' && format === 'depth32float-stencil8') return 'depth32float'
  return format
}

/** Two formats that view or copy one another: equal, or differing only by `-srgb`. */
export const srgbPair = (a: string, b: string) =>
  a.replace(/-srgb$/, '') === b.replace(/-srgb$/, '')

/** The usage bits of `usage` a view in `format` cannot hold, by the name the device gives them. */
export function usageRefusedBy(format: string, usage: number, features: Features) {
  const refused: string[] = []
  if (usage & TEXTURE.STORAGE_BINDING && !isStorage(format)) refused.push('StorageBinding')
  if (usage & TEXTURE.RENDER_ATTACHMENT && !isRenderable(format, features))
    refused.push('RenderAttachment')
  return refused
}
