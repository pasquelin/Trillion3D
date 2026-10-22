import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { AO_DOWNSAMPLE } from './cones.ts'
import { DFAO_GRID_WGSL } from './gridWgsl.ts'
import { DFAO_BINDING as B, DFAO_BENT_FORMAT } from './layout.ts'

/** The side of the group of cone-grid cells one combine covers. */
export const COMBINE_GROUP = 8

/**
 * THE CONES' VISIBILITIES COMBINED INTO A BENT NORMAL (`dfaoCombine`), a thread a cone-grid cell: the sum of the
 * nine cones' directions, each weighed by its visibility, in the surface's tangent frame turned to the world,
 * times the factor that brings the nine unoccluded to unit length over nine. Its length is the share of the sky the
 * surface sees, its direction where the sky is most open. The cell is written with its scene depth in the alpha,
 * which the upsample weighs its neighbours by. The cell's surface is the grid's, held to the cells of the view.
 */
export const DFAO_COMBINE_WGSL = wgslProgram(
  `@group(0) @binding(${B.visibility}) var<storage,read> coneVisibility:array<u32>;
@group(0) @binding(${B.output}) var bentOut:texture_storage_2d<${DFAO_BENT_FORMAT},write>;
@compute @workgroup_size(${COMBINE_GROUP},${COMBINE_GROUP})
fn dfaoCombine(@builtin(global_invocation_id) id:vec3u){
 let input=min(id.xy,dfao.cones.xy-vec2u(1u));
 let texel=min(dfaoCellTexel(input),vec2i(dfao.grid.zw/${AO_DOWNSAMPLE}u)-vec2i(1));
 let surface=dfaoGrid(texel);
 let axes=dfaoAxes(surface.xyz);
 let cell=input.y*dfao.cones.x+input.x;
 var unoccluded=vec3f(0.0);
 for(var cone=0u;cone<CONE_DIRECTIONS;cone++){
  let visibility=bitcast<f32>(coneVisibility[dfaoVisibilityIndex(cone,cell)]);
  unoccluded+=visibility*dfaoConeDirection(cone,surface.xyz,axes);
 }
 let bent=unoccluded*(dfao.global.z/f32(CONE_DIRECTIONS));
 textureStore(bentOut,vec2i(id.xy),vec4f(bent,surface.w));
}`,
  [DFAO_COMMON_WGSL, DFAO_GRID_WGSL],
)
