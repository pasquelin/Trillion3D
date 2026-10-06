/**
 * Material classes of the surface resolve, the published visibility-buffer design: the resolve
 * does not branch per pixel on what a material has, it runs one draw per class. A class is the
 * set of features the shader would otherwise test at run time — its key is a word of feature
 * bits, and every page of a class carries the same bits.
 *
 * Each class draws the screen tiles that hold its pixels (`materialTilesWgsl.ts`), compiled with
 * the class's feature bits as pipeline overrides, and its fragment stage keeps its own pixels
 * only (`classAdmits`).
 */
export const CLASS_FEATURE = {
  HAS_UV: 1,
  HAS_MAP: 2,
  HAS_MASK: 4,
  HAS_ROUGH: 8,
  HAS_METAL: 16,
  HAS_AO: 32,
  HAS_EMISSIVE: 64,
  HAS_NORMAL_MAP: 128,
  HAS_VERTEX_NORMAL: 256,
  DOUBLE_SIDED: 512,
  HAS_TANGENT: 1024,
  /** A map read through its filter rule (`FLAG_SAMPLED`): without it, the class compiles the
   *  default read alone. */
  HAS_SAMPLING: 2048,
  /** The base colour is multiplied by the vertex colour (`FLAG_HAS_COLOR`). */
  HAS_VERTEX_COLOR: 4096,
} as const
