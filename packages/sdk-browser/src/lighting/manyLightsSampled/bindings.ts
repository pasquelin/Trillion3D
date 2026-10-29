/** The bindings the sampled lighting's kernels add to the lighting's own (`../deferred/bindings.ts`, numbers below 100): in group 0,
 *  each kernel binds the ones it reads and none else. */
export const SAMPLED_BINDINGS = {
  /** The uniform of the image (`SAMPLED_PARAMS`). */
  params: 120,
  /** A word a tile of the view: the bits of what its pixels are (`TILE_BIT`). */
  tileBitmask: 121,
  /** The count of tiles each mode holds, the tiles of each mode, and the arguments of the dispatch over each, for the view's tiles... */
  tileAllocator: 122,
  tileData: 123,
  tileArgs: 124,
  /** ... and for the tiles of the downsampled view. */
  downAllocator: 125,
  downData: 126,
  downArgs: 127,
  /** A word a sample: the light drawn, its weight, whether it is visible (`packLightSample`). */
  samples: 128,
  /** A word a sample: the ray that will be traced (`packLightSampleRay`). */
  rays: 129,
  /** The guide of the last image (visible sets, hidden sets, light power ratios) and the one this image writes. */
  guideHistory: 130,
  guideCurrent: 131,
  /** The hash of what each tile saw before the neighbouring tiles' are joined to it (read by the filter of the sets). */
  hashRaw: 162,
  /** The blue noise. */
  blue: 132,
  /** The surfaces' motion vectors of the image (two words a texel). */
  vectors: 133,
  /** The compacted list of the samples whose rays are still to be traced (a word each, `x << 16 | y`), their count, and the arguments of the dispatch over them. */
  compactData: 134,
  compactCount: 135,
  compactArgs: 136,
  /** What the shading resolves each pixel to: the diffuse and the specular light, demodulated, the diffuse's alpha the shading confidence. */
  resolvedDiffuse: 137,
  resolvedSpecular: 138,
  /** The temporal filter's history of the image before (read) and the one it writes (diffuse, specular, moments, frames and depth), its sampler and the pre-exposure of each image. */
  historyDiffuse: 150,
  historySpecular: 151,
  historyMoments: 152,
  historyFrames: 153,
  filteredDiffuse: 154,
  filteredSpecular: 155,
  filteredMoments: 156,
  filteredFrames: 157,
  historySampler: 158,
  exposureBefore: 159,
  exposureNow: 160,
  /** The spatial filter's output: the light to add to the lit image, demodulation put back. */
  composite: 161,
  /** The spatial filter's debug output (`spatialDebugWgsl.ts`), written only while a debug view asks. */
  debugPixels: 163,
  /** The lights' power of the image before (read) and of this one (written), per rank. */
} as const
