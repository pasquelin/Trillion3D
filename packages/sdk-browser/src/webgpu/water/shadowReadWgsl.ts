import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
/**
 * Where a water pixel reads its shadows: the side its normal faces, at the footprint the
 * deferred resolve lights a pixel at (`pixelFootprint`, `footprintWgsl.ts`; `compositeWgsl.ts`,
 * `waterColor`).
 */
export const WATER_SHADOW_READ_WGSL = wgslBlock(
  'WATER_SHADOW_READ_WGSL',
  [],
  `/** Normal \`N\` turned to the side \`V\` looks from: a single-sided surface, or a mesh with no normal
 *  attribute, can arrive turned the wrong way. */
fn waterFacing(N:vec3f,V:vec3f)->vec3f{return select(-N,N,dot(N,V)>0.0);}`,
)
