/**
 * THE MATERIAL OF A STRAND, in numbers: what the material pass (`materialPass.ts`) writes for each
 * compacted sample, and the twin of its packing the proofs and the passes after it read the words
 * by. A sample's material is five words (`HAIR_NODE_DATA_WORDS`):
 * 0. its depth, a float;
 * 1. its control point on the low 28 bits, its macro group on the high four;
 * 2. its tangent (`tangent * 0.5 + 0.5` a byte, three bytes) and its coverage of the pixel (a byte);
 * 3. the square root of its base colour (three bytes) and its roughness (a byte);
 * 4. its specular (a byte), its backlit share (a byte), its flags (a byte, `HAIR_FLAG`) and the
 *    lighting channels of its object (three bits).
 * The colour is kept as its square root for the precision of the darks. Bytes are `floor(x * 255)`.
 */

/** The bits of a sample's flags: the strands light the light that reaches the scene behind them, are
 *  drawn at the stable width, are traced as geometry, are held out of the image, cast a contact shadow, write the custom depth. */
export const HAIR_FLAG = {
  scatterSceneLight: 0x1,
  stableRaster: 0x2,
  rayTracedGeometry: 0x4,
  holdout: 0x8,
  castContactShadow: 0x10,
  renderCustomDepth: 0x20,
} as const

/** What a group of strands is given where the file gives it none: the default values of the default strand
 *  material's colour (linear) and roughness parameters, the specular and backlit share the material
 *  inputs hold unconnected, and the lighting channel 0 an object is in by default (a mask of one bit). */
export const HAIR_DEFAULT_MATERIAL = {
  color: [0.2395, 0.1862, 0.10725],
  roughness: 0.333,
  specular: 0.5,
  backlit: 1,
  lightChannels: 1,
} as const

/** The macro groups a view holds at most, and where a sample's word keeps its macro group. */
export const HAIR_MACRO_GROUP_SHIFT = 28
export const HAIR_MACRO_GROUP_MASK = 0xf
