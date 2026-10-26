import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'
import { hasTextureFormatsTier1 } from '../../gpu/core/textureFormatsTier.ts'

/**
 * THE FORM OF A RESOURCE THE SHADING REJECTION WRITES FOR THE SPATIAL ANTI-ALIASER: a one-byte
 * storage texture where the device has `texture-formats-tier1` (the format is a storage format under
 * it only) and grants the storage texture it takes beside the rejection's others, else a storage
 * buffer. One choice for a device (`rejectionStorageForms`), made with the history's formats
 * (`historyFormatsOf`, `historyShape.ts`), which the pipelines and layouts follow.
 */
export type StorageForm = 'texture' | 'buffer'

/** The forms of the rejection's two optional resources. */
export interface StorageForms {
  readonly mask: StorageForm
  readonly luma: StorageForm
}

/** Both resources as buffers: a device without the tier, or whose driver refused its programs. */
export const BUFFER_FORMS: StorageForms = { mask: 'buffer', luma: 'buffer' }

/** The storage textures per shader stage WebGPU guarantees a device that names no limit (the default of
 *  `maxStorageTexturesPerShaderStage`). */
export const GUARANTEED_STORAGE_TEXTURES = 4

/** The storage textures per stage the rejection always binds, whatever the forms: the shading
 *  history, the flicker history, the rejection and the field (`rejectShadingEntries`,
 *  `analysisLayouts.ts`, which a test counts against this; the layouts' module is not imported here, it
 *  would draw every program of the analysis into the history's shape). A count of its own, not the
 *  guaranteed limit, which it only happens to equal. */
const REJECTION_STORAGE_TEXTURES = 4

/** The rejection's optional resources, in the order they are granted a texture: the mask first,
 *  its buffer form costing more (a word a texel against a byte). */
const PRIORITY = ['mask', 'luma'] as const

/** The forms of the rejection's mask and luma on a device of `features` and `limits`: each a texture
 *  in turn while the stage's limit holds the textures bound so far, tier 1 checked once. */
export const rejectionStorageForms = (
  features: { has(name: string): boolean },
  limits: { maxStorageTexturesPerShaderStage?: number } | undefined,
): StorageForms => {
  if (!hasTextureFormatsTier1(features)) return BUFFER_FORMS
  let room =
    (limits?.maxStorageTexturesPerShaderStage ?? GUARANTEED_STORAGE_TEXTURES) -
    REJECTION_STORAGE_TEXTURES
  const [mask, luma] = PRIORITY.map((): StorageForm => (room-- > 0 ? 'texture' : 'buffer'))
  return { mask, luma }
}

/** What one resource is, where its texture and buffer forms differ in the programs, the layouts and
 *  the targets. */
export interface StorageResource {
  /** The texture form's format. */
  readonly format: GPUTextureFormat
  /** The target's label. */
  readonly label: string
  /** The variable the anti-aliaser reads and the one the rejection writes. */
  readonly variable: { readonly read: string; readonly write: string }
  /** The texture form as the anti-aliaser reads it: a storage texture loaded, or a sampled one. */
  readonly read: 'storage' | 'sampled'
  /** The element of the buffer form as the rejection writes it. */
  readonly written: string
  /** The words of the buffer form for `texels` texels. */
  readonly words: (texels: number) => number
  /** Bytes a texel takes in each form. */
  readonly texelBytes: Record<StorageForm, number>
}

/** The anti-aliasing mask, the texels the rejection asks the anti-aliaser on: an `r8uint` texture, or
 *  a word a texel, 1 where the rejection asks for it, 0 else. */
export const ANTI_ALIAS_MASK: StorageResource = {
  format: 'r8uint',
  label: 'Trillion3D TAA anti-aliasing mask',
  variable: { read: 'antiAliasMask', write: 'antiAliasMaskOut' },
  read: 'storage',
  written: 'u32',
  words: (texels) => texels,
  texelBytes: { texture: 1, buffer: 4 },
}

/** The LDR luma the rejection writes for the anti-aliaser to browse: an `r8unorm` texture, or the
 *  bytes of a buffer, four texels of a row a word, the first in the low byte, as such a texture holds
 *  it; each texel clears its byte and sets it with two atomics (`rejectionWgsl.ts`). */
export const LDR_LUMA: StorageResource = {
  format: 'r8unorm',
  label: 'Trillion3D TAA LDR luma',
  variable: { read: 'luma', write: 'lumaOut' },
  read: 'sampled',
  written: 'atomic<u32>',
  words: (texels) => ceilDiv(texels, 4),
  texelBytes: { texture: 1, buffer: 1 },
}

/** The declaration of the variable of `resource` in a program, at `binding`, in `form`, for
 *  `access`: the anti-aliaser's read or the rejection's write. */
export const storageDeclaration = (
  resource: StorageResource,
  form: StorageForm,
  access: 'read' | 'write',
  binding: number,
) => {
  const { format, variable, read, written } = resource
  const at = `@group(0) @binding(${binding})`
  if (access === 'write')
    return form === 'texture'
      ? `${at} var ${variable.write}:texture_storage_2d<${format},write>;`
      : `${at} var<storage,read_write> ${variable.write}:array<${written}>;`
  if (form === 'buffer') return `${at} var<storage,read> ${variable.read}:array<u32>;`
  return read === 'sampled'
    ? `${at} var ${variable.read}:texture_2d<f32>;`
    : `${at} var ${variable.read}:texture_storage_2d<${format},read>;`
}

/** The bind group layout entry of `resource` at `binding`, in `form`, for `access`. */
export const storageEntry = (
  resource: StorageResource,
  form: StorageForm,
  access: 'read' | 'write',
  binding: number,
): GPUBindGroupLayoutEntry => {
  if (form === 'buffer')
    return computeBufferEntry(binding, access === 'write' ? 'storage' : 'read-only-storage')
  if (access === 'write') return computeStorageTextureEntry(binding, resource.format)
  return resource.read === 'sampled'
    ? computeTextureEntry(binding, 'float')
    : computeStorageTextureEntry(binding, resource.format, 'read-only')
}
