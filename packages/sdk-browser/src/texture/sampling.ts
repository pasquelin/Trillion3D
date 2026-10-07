import type { Texture, TextureFilter } from '../../../sdk-core/src/index.ts'
import { AFFINE, grantedAnisotropy, uvTransformed } from '../../../sdk-core/src/texture/contract.ts'
import { wrapNibble } from '../visibility/wrapModes.ts'
import { MAX_ANISOTROPY } from './maxAnisotropy.ts'

/**
 * How a texture is sampled, carried in its header of the page table (`pageTable.ts`): a filter
 * word and its addressing nibble (`wrapNibble`), packed above the texture's last level in a word
 * the shader already reads, then its UV transform — six floats, the 2 × 3 affine part of
 * `Texture.transform` — fetched only by a texture that has one.
 *
 * The pools have no hardware sampler state to set per texture: a tile is read through one
 * linear sampler, the level is chosen and mixed by the shader (`samplingWgsl.ts`). So the filter is a
 * rule of that shader, not a sampler: `nearest` reads the centre of the texel the coordinate
 * falls in — the linear sampler at a texel centre returns that texel alone —, a mip rule rounds
 * the level, and anisotropy reads along the longer axis of the footprint at the level of the
 * shorter one, as many taps as the footprint is elongated, up to the texture's grant: one on a
 * surface seen face-on. No sampler and no bind group is created per texture.
 *
 * One rule for every texture, whoever built its chain — the cache's levels, streamed by tile, or
 * the GPU's for a texture created in the page (`../webgpu/tile/scratch.ts`): the level is the
 * footprint's. A filter without `mip` picks the read inside a level — nearest or linear — and
 * never the level, so level selection and tile requests stay those of the default read.
 *
 * Bits of the filter word, zero for the default `linear` / `linear-mip-linear` / 1 × untransformed:
 * the zero word takes the read the pools had before, and nothing else. Which read a pass compiles
 * is not tested per sample: a page whose maps are all at zero carries no `FLAG_SAMPLED`, and its
 * resolve class — `HAS_SAMPLING` — compiles the default read alone (`samplingWgsl.ts`).
 */
export const SAMPLE_MAG_NEAREST = 1,
  SAMPLE_MIN_NEAREST = 2,
  SAMPLE_MIP_NEAREST = 4,
  /** Anisotropy minus one, four bits. */
  SAMPLE_ANISOTROPY_SHIFT = 3,
  /** The transform is not the identity: only then does the shader read it. */
  SAMPLE_TRANSFORMED = 128,
  /** Where the addressing nibble sits, above the filter bits: outside the zero test, so a
   *  repeating texture at the default filters keeps the default read. */
  SAMPLE_WRAP_SHIFT = 8,
  /** The filter bits: a texture whose bits are all zero takes the default read. */
  SAMPLE_FILTER_MASK = (1 << SAMPLE_WRAP_SHIFT) - 1

/** Header words of a texture's UV transform: the affine 2 × 3 part. */
export const TRANSFORM_WORDS = 6

/** Base filter and mip rule of each filter name; a filter without `mip` mixes the levels as the
 *  default read does. */
const MIN_BITS: Record<TextureFilter, number> = {
  nearest: SAMPLE_MIN_NEAREST,
  linear: 0,
  'nearest-mip-nearest': SAMPLE_MIN_NEAREST | SAMPLE_MIP_NEAREST,
  'nearest-mip-linear': SAMPLE_MIN_NEAREST,
  'linear-mip-nearest': SAMPLE_MIP_NEAREST,
  'linear-mip-linear': 0,
}

/** Where `samplingWords` writes: one array, reused, read back by its caller before the next call. */
const scratch = new Uint32Array(1 + TRANSFORM_WORDS),
  scratchFloats = new Float32Array(scratch.buffer)

/**
 * A texture's filter word with its addressing nibble, then its transform's six floats as their
 * bits, in an array the next call overwrites. Anisotropy follows `grantedAnisotropy`, clamped to
 * WebGPU's ceiling.
 */
export function samplingWords(texture: Texture): Uint32Array {
  const anisotropy = Math.round(grantedAnisotropy(texture, MAX_ANISOTROPY))
  const m = texture.transform
  scratch[0] =
    (texture.magFilter === 'nearest' ? SAMPLE_MAG_NEAREST : 0) |
    MIN_BITS[texture.minFilter] |
    ((anisotropy - 1) << SAMPLE_ANISOTROPY_SHIFT) |
    (uvTransformed(m) ? SAMPLE_TRANSFORMED : 0) |
    (wrapNibble(texture) << SAMPLE_WRAP_SHIFT)
  for (let i = 0; i < TRANSFORM_WORDS; i++) scratchFloats[1 + i] = m[AFFINE[i]]
  return scratch
}
