/**
 * The engine's texture: the image the compiler imported and the sampler state declared beside it,
 * in the engine's own words. No rendering-library object — a texture reaches a pool, an atlas lane
 * or a wrap word as this record and nothing else.
 *
 * The addressing and filtering words are the engine's enums, not a host library's integers: the
 * rules that read them (`packages/sdk-browser/src/visibility/wrapModes.ts`, `packages/sdk-browser/src/visibility/math.ts`) compute on the name, and the
 * two graphics boundaries — the WebGL2 binder, the WebGPU tile pool — are the only places that turn
 * one back into an API constant.
 */

/** How a coordinate outside `[0, 1]` is brought back: the three modes glTF declares. */
export type WrapMode = 'clamp' | 'repeat' | 'mirror';

/** Sampling rule of a texture: the base filter, and the mip rule when the sampler minifies. */
export type TextureFilter =
  | 'nearest'
  | 'linear'
  | 'nearest-mip-nearest'
  | 'nearest-mip-linear'
  | 'linear-mip-nearest'
  | 'linear-mip-linear';

/** How the texels are encoded: a colour map carries an sRGB transfer curve, a data map does not. */
export type TextureColorSpace = 'srgb' | 'linear';

/** One imported texture, held by identity: an atlas layer, a preview rank or a wrap nibble is
 *  addressed by the record itself, so one source texture is one record for the session. */
export interface Texture {
  /** Identity of the texture in the imported scene: what a cache key and a message name it by. */
  readonly id: string;
  /** Name the source file gave it, empty when it gave none; read by messages only. */
  readonly name: string;
  /** Bumped whenever the texels change: what an upload compares to skip a re-copy. */
  readonly version: number;
  /** The decoded image. Its container stays `unknown`: only the boundary that uploads it knows. */
  readonly image: unknown;
  /** UV set the sampler reads, `KHR_texture_transform`'s `texCoord`; the engine samples 0 and 1. */
  readonly channel: number;
  /** Repeat across. */
  readonly wrapS: WrapMode;
  /** Repeat up. */
  readonly wrapT: WrapMode;
  /** Filter when bigger. */
  readonly magFilter: TextureFilter;
  /** Filter when smaller. */
  readonly minFilter: TextureFilter;
  /** Sharpness at a slant. */
  readonly anisotropy: number;
  /** Whether rows are flipped. */
  readonly flipY: boolean;
  /** Whether colour is pre-multiplied. */
  readonly premultiplyAlpha: boolean;
  /** Whether smaller copies are made. */
  readonly generateMipmaps: boolean;
  /** How its numbers are read. */
  readonly colorSpace: TextureColorSpace;
  /** UV transform of the sampler, `KHR_texture_transform` composed into three rows of three. */
  readonly transform: ArrayLike<number>;
}
