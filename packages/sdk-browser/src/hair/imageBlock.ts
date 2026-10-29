import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** The words of the image block (`HAIR_IMAGE_WGSL`). */
export const HAIR_IMAGE_WORDS = 12

/**
 * WHAT THE PASSES OVER THE STRANDS' IMAGE READ OF IT, one block at binding 0 of their group 0: the
 * size of the image in pixels, the first tile of the rectangle the strands cover (the passes over
 * tiles go from it), the room of a list of tiles, the coverage from which a pixel counts as full, the
 * room for compacted samples, whether a pixel's list is sorted by depth, and the layer of the
 * surfaces' colours that holds the emission (0 for none), which the patch of the surfaces empties, and whether the tiles with strands are
 * widened by a pixel (the hardware raster's samples lie off the pixel centres the transmittance is read at).
 */
export const HAIR_IMAGE_WGSL = wgslBlock(
  'HAIR_IMAGE_WGSL',
  [],
  `struct HairImage{size:vec2u,origin:vec2u,capacity:u32,fullCoverage:f32,maxNodes:u32,sortByDepth:u32,emission:u32,dilate:u32,pad1:u32,pad2:u32}
@group(0) @binding(0) var<uniform> image:HairImage;`,
)

/** A band of the visibility samples (`hairBandRows`): the rows `first` to `end` of the image, held in a
 *  buffer of their own, whose identifier plane (a device without the 64-bit word) starts at the word
 *  `plane`; one block each, bound beside the band's buffer. A sample of a pixel of row `y` is the
 *  `(y - first) * width + x`-th pixel's of the band. */
export const HAIR_BAND_WGSL = wgslBlock(
  'HAIR_BAND_WGSL',
  [],
  `struct HairBand{first:u32,end:u32,plane:u32,pad:u32}`,
)
