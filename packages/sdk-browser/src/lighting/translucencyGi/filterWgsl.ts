import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { GI_FRAME_WGSL, giFormatWgsl, giQuantizeWgsl } from './frameWgsl.ts'
import { TRANSLUCENCY_GI_GROUP } from './layout.ts'

/** Where the spatial filter binds what it reads and writes, in group 0: the frame, the cones' light read and the light written. */
export const FILTER_GI_BINDING = { frame: 0, input: 1, output: 2 } as const
const b = FILTER_GI_BINDING

/**
 * THE SPATIAL FILTER OF THE CONES' LIGHT, one separable pass an axis (`filterX`, `filterY`, `filterZ`, in this order, each reading what the
 * pass before wrote): a thread a cone averages the same cone of the cells `gi.spatial.x` either side of its cell along the axis, weighed by a
 * Gaussian of the distance in cells (`gi.spatial.y`, `gi.spatial.z`: its two factors from the standard deviation), the cells off the grid
 * left out and the weights summed to one, written to the format's precision (`giQuantize`, the draw of the texel, the slice and the axis).
 */
const filterGiWgsl = (format: GPUTextureFormat) =>
  wgslBlock(
    `FILTER_GI_WGSL(${format})`,
    [GI_FRAME_WGSL, giQuantizeWgsl(format)],
    `fn giGauss(distance:f32)->f32{return gi.spatial.z*exp(-distance*distance*gi.spatial.y);}
fn giFilter(id:vec3u,axis:vec3i){
 let res=u32(gi.trace.x);
 let cell=vec3u(id.xy/res,id.z);
 let texel=id.xy-cell.xy*res;
 if(any(cell>=gi.grid.xyz)||any(texel>=vec2u(res))){return;}
 var sum=vec3f(0.0);
 var total=0.0;
 let reach=i32(gi.spatial.x);
 for(var offset=-reach;offset<=reach;offset++){
  let near=vec3i(cell)+axis*offset;
  if(any(near<vec3i(0))||any(near>=vec3i(gi.grid.xyz))){continue;}
  let weight=giGauss(f32(offset));
  sum+=textureLoad(coneIn,vec3i(vec2i(near.xy)*i32(res)+vec2i(texel),near.z),0).xyz*weight;
  total+=weight;
 }
 let axisIndex=u32(axis.y+2*axis.z);
 textureStore(coneOut,id,vec4f(giQuantize(sum/max(total,0.00001),id.xy,id.z*3u+axisIndex),0.0));
}
@compute @workgroup_size(${TRANSLUCENCY_GI_GROUP},${TRANSLUCENCY_GI_GROUP},1)
fn filterX(@builtin(global_invocation_id) id:vec3u){giFilter(id,vec3i(1,0,0));}
@compute @workgroup_size(${TRANSLUCENCY_GI_GROUP},${TRANSLUCENCY_GI_GROUP},1)
fn filterY(@builtin(global_invocation_id) id:vec3u){giFilter(id,vec3i(0,1,0));}
@compute @workgroup_size(${TRANSLUCENCY_GI_GROUP},${TRANSLUCENCY_GI_GROUP},1)
fn filterZ(@builtin(global_invocation_id) id:vec3u){giFilter(id,vec3i(0,0,1));}`,
  )

/** The filter's program over cones' light in `format`: its three entry points. */
export const filterGiProgram = (format: GPUTextureFormat) =>
  wgslProgram(
    `@group(0) @binding(${b.frame}) var<uniform> gi:TranslucencyGiFrame;
@group(0) @binding(${b.input}) var coneIn:texture_3d<f32>;
@group(0) @binding(${b.output}) var coneOut:texture_storage_3d<${format},write>;`,
    [filterGiWgsl(format), ...giFormatWgsl(format)],
  )
