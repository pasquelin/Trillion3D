import { computeStorageTextureEntry } from './computeBindings.ts'
import { texelBytesOf, wantedTargetBytes } from './textureBytes.ts'

/**
 * A target a fragment stage reads by load alone — the subsurface, the lobes —, bound as a read-only storage texture: `textureLoad` returns the stored values
 * exactly, and none of the sixteen sampled textures a stage is guaranteed is spent on it
 * (`../../lighting/deferred/layoutEntries.ts`). `layers` above one make it an array texture, still one binding. Its WGSL declaration of `name` at `binding`, and its layout
 * entry — the bind groups name `binding` by the caller's own constant —; the texture that backs it
 * carries `STORAGE_BINDING`, which its allocator owns (`loadOnlyUsage`). Read-only storage textures
 * ask the WGSL language feature `readonly_and_readwrite_storage_textures`
 * (`WEBGPU_REQUIRED_WGSL_FEATURES`).
 */
export function loadOnlyTarget(
  binding: number,
  format: GPUTextureFormat,
  name: string,
  layers = 1,
) {
  /** Bytes of one texel of its format, a layer after another. */
  const texelBytes = texelBytesOf(format) * layers
  const array = layers > 1
  return {
    texelBytes,
    /** Bytes of the target of a `width` × `height` frame: a texel per pixel when `wanted`, a 1×1
     *  placeholder otherwise. */
    bytes: (width: number, height: number, wanted: boolean) =>
      wantedTargetBytes(width, height, wanted, texelBytes),
    wgsl: `@group(0) @binding(${binding}) var ${name}:texture_storage_2d${array ? '_array' : ''}<${format},read>;`,
    /** Its layout entry, made when a layout is: the stage constants exist then. */
    layoutEntry: (): GPUBindGroupLayoutEntry =>
      computeStorageTextureEntry(
        binding,
        format,
        'read-only',
        array ? '2d-array' : '2d',
        GPUShaderStage.FRAGMENT,
      ),
  }
}

/** The usage of a texture a load-only target binds, read only where it is written as storage. */
export const loadOnlyUsage = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
