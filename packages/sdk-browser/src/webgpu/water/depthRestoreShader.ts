import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

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

/** The fullscreen triangle writing each texel's own opaque depth. */
export const WATER_DEPTH_RESTORE_SHADER = wgslModule(FULLSCREEN_VERTEX, DEPTH_RESTORE_WGSL)
