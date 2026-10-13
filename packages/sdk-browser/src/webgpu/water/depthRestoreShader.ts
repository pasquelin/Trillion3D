import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { waterQuadWgsl } from './quadWgsl.ts'

/** The binding of the verdict the restore's quad reads its rectangle from (`quadWgsl.ts`). */
export const RESTORE_RECT_BINDING = 1

/** Exact depth texel restore for the cropped water initialization: source and destination use the
 *  same pixel coordinates and depth32float representation. */
const DEPTH_RESTORE_WGSL = wgslBlock(
  'DEPTH_RESTORE_WGSL',
  [],
  `
@group(0) @binding(0) var layer:texture_depth_2d;
@fragment fn restore_fs(@builtin(position) p:vec4f)->@builtin(frag_depth) f32{
 return textureLoad(layer,vec2i(p.xy),0);
}
`,
)

/** The water rectangle's quad writing each texel's own opaque depth. */
export const WATER_DEPTH_RESTORE_SHADER = wgslModule(
  waterQuadWgsl(RESTORE_RECT_BINDING),
  DEPTH_RESTORE_WGSL,
)
