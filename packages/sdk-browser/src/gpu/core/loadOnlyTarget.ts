import { textureBytesOf } from './textureBytes.ts'

/**
 * A target a fragment stage reads by load alone — the subsurface, the lobes, the shadow mask's
 * decode table —, bound as a read-only storage texture: `textureLoad` returns the stored values
 * exactly, and none of the sixteen sampled textures a stage is guaranteed is spent on it
 * (`../../lighting/deferred/setup.ts`). Its WGSL declaration of `name` at `binding`, and its layout
 * entry — the bind groups name `binding` by the caller's own constant —; the texture that backs it
 * carries `STORAGE_BINDING`, which its allocator owns (`loadOnlyUsage`). Read-only storage textures
 * ask the WGSL language feature `readonly_and_readwrite_storage_textures`
 * (`WEBGPU_REQUIRED_WGSL_FEATURES`).
 */
export function loadOnlyTarget(binding: number, format: GPUTextureFormat, name: string) {
  /** Bytes of one texel of its format (`textureBytesOf`). */
  const texelBytes = textureBytesOf({ size: [1, 1], format }) ?? 0
  return {
    texelBytes,
    /** Bytes of the target of a `width` × `height` frame: a texel per pixel when `wanted`, a 1×1
     *  placeholder otherwise. */
    bytes: (width: number, height: number, wanted: boolean) =>
      (wanted ? width * height : 1) * texelBytes,
    wgsl: `@group(0) @binding(${binding}) var ${name}:texture_storage_2d<${format},read>;`,
    /** Its layout entry, made when a layout is: the stage constants exist then. */
    layoutEntry: (): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      storageTexture: { access: 'read-only', format },
    }),
  }
}

/** The usage of a texture a load-only target binds, read only where it is written as storage. */
export const loadOnlyUsage = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
