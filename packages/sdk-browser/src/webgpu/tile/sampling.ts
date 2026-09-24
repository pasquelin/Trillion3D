import type { Texture, TextureFilter } from '../../../../sdk-core/src/index.ts';
import {
  AFFINE,
  grantedAnisotropy,
  uvTransformed,
} from '../../../../sdk-core/src/texture/contract.ts';
import { wrapNibble } from '../../visibility/wrapModes.ts';

/**
 * How a texture is sampled on WebGPU, carried in its header of the page table
 * (`pageTable.ts`): a filter word and its addressing nibble (`wrapNibble`), packed above the
 * texture's last level in a word the shader already reads, then its UV transform — six floats,
 * the 2 × 3 affine part of `Texture.transform`, the very matrix the WebGL2 binder uploads
 * (`../../webgl/cluster/materialBinding.ts`) — fetched only by a texture that has one.
 *
 * The pools have no hardware sampler state to set per texture: a tile is read through one
 * linear sampler, the level is chosen and mixed by the shader (`samplingWgsl.ts`). So the filter is a
 * rule of that shader, not a sampler: `nearest` reads the centre of the texel the coordinate
 * falls in — the linear sampler at a texel centre returns that texel alone —, a mip rule rounds
 * or pins the level, and anisotropy reads along the longer axis of the footprint at the level of
 * the shorter one, as many taps as the footprint is elongated, up to the texture's grant: one on
 * a surface seen face-on. No sampler and no bind group is created per texture.
 *
 * A filter without `mip` depends on who owns the chain. A texture of the compiled cache carries
 * the engine's own levels, streamed by tile: its filter picks the read inside a level — nearest
 * or linear — and never the level, so level selection and tile requests stay those of the
 * default read. A texture created in the page is uploaded as a single picture, the case WebGL2
 * reads at level 0 whatever the footprint: there the rule is WebGL2's, level 0.
 *
 * Bits of the filter word, zero for the default `linear` / `linear-mip-linear` / 1 × untransformed:
 * the zero word takes the read the pools had before, and nothing else.
 */
export const SAMPLE_MAG_NEAREST = 1,
  SAMPLE_MIN_NEAREST = 2,
  SAMPLE_MIP_NEAREST = 4,
  /** No mip rule: level 0 whatever the footprint, a filter without `mip` on a page texture. */
  SAMPLE_MIP_NONE = 8,
  /** Anisotropy minus one, four bits. */
  SAMPLE_ANISOTROPY_SHIFT = 4,
  /** The transform is not the identity: only then does the shader read it. */
  SAMPLE_TRANSFORMED = 256,
  /** Minification starts at level 0.5, not 0: GL's rule for a linear magnification over a
   *  `nearest-mip-*` minification (OpenGL ES 3.0 § 3.8.11, `c`). */
  SAMPLE_MAG_HALF = 512,
  /** Where the addressing nibble sits, above the filter bits: outside the zero test, so a
   *  repeating texture at the default filters keeps the default read. */
  SAMPLE_WRAP_SHIFT = 10;

/** The most reads anisotropic filtering takes, WebGPU's `maxAnisotropy` ceiling. */
export const MAX_ANISOTROPY = 16;

/** Header words of a texture's UV transform: the affine 2 × 3 part. */
export const TRANSFORM_WORDS = 6;

/** Base filter and mip rule of each filter name. */
const MIN_BITS: Record<TextureFilter, number> = {
  nearest: SAMPLE_MIN_NEAREST | SAMPLE_MIP_NONE,
  linear: SAMPLE_MIP_NONE,
  'nearest-mip-nearest': SAMPLE_MIN_NEAREST | SAMPLE_MIP_NEAREST,
  'nearest-mip-linear': SAMPLE_MIN_NEAREST,
  'linear-mip-nearest': SAMPLE_MIP_NEAREST,
  'linear-mip-linear': 0,
};

/** Where `samplingWords` writes: one array, reused, read back by its caller before the next call. */
const scratch = new Uint32Array(1 + TRANSFORM_WORDS),
  scratchFloats = new Float32Array(scratch.buffer);

/**
 * A texture's filter word with its addressing nibble, then its transform's six floats as their
 * bits, in an array the next call overwrites. `compiled` says the texture's levels are the cache's (see above). Anisotropy
 * follows the rule both GPU paths share (`grantedAnisotropy`), clamped to its ceiling.
 */
export function samplingWords(texture: Texture, compiled: boolean): Uint32Array {
  const anisotropy = Math.round(grantedAnisotropy(texture, MAX_ANISOTROPY));
  const m = texture.transform;
  scratch[0] =
    (texture.magFilter === 'nearest' ? SAMPLE_MAG_NEAREST : 0) |
    (MIN_BITS[texture.minFilter] & (compiled ? ~SAMPLE_MIP_NONE : ~0)) |
    ((anisotropy - 1) << SAMPLE_ANISOTROPY_SHIFT) |
    (uvTransformed(m) ? SAMPLE_TRANSFORMED : 0) |
    (texture.magFilter !== 'nearest' && texture.minFilter.startsWith('nearest-mip')
      ? SAMPLE_MAG_HALF
      : 0) |
    (wrapNibble(texture) << SAMPLE_WRAP_SHIFT);
  for (let i = 0; i < TRANSFORM_WORDS; i++) scratchFloats[1 + i] = m[AFFINE[i]];
  return scratch;
}
