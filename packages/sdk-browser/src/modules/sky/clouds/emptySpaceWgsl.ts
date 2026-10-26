import { uvToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { airProgram } from '../../../lighting/atmosphere/programs.ts'
import { DEFAULT_AIR_SHAPE, type AirShape } from '../../../lighting/atmosphere/shape.ts'
import { CLOUD_MATERIAL_EMPTY_SPACE_WGSL, cloudMaterialBindings } from './materialWgsl.ts'
import { CLOUD_RAY_WGSL } from './traceMarchWgsl.ts'
import { CLOUD_TRACE_BINDING as B, CLOUD_TRACE_LAYOUT } from './traceLayout.ts'
import { CLOUD_EMPTY_SPACE_SIDE, CLOUD_EMPTY_SPACE_SLICES } from './traceOptions.ts'
import { CLOUD_TRACE_AIR } from './traceWgsl.ts'
import { CLOUD_POINT_WGSL } from './traceLightWgsl.ts'

/** The empty-space pass's own group: group 0 is the air's. */
const G = 1

/** Where the pass binds what it reads and writes in its group: the trace's block and the material
 *  where the trace binds them, and the table it writes. */
export const CLOUD_EMPTY_SPACE_BINDING = { material: B.material, block: B.block, table: 8 } as const

/** The table's format: one float, the distance in kilometres (a storage texture cannot be a stride). */
export const CLOUD_EMPTY_SPACE_FORMAT: GPUTextureFormat = 'r32float'

export const CLOUD_EMPTY_SPACE_ENTRY = 'cloudEmptySpaceMain'

/**
 * THE EMPTY-SPACE TABLE: for each texel of a 32 by 32 table over the view, how far from the eye
 * the first cloud may be, in kilometres, so that the view tracing (`traceExtraWgsl.ts`) starts its
 * march there. One group to a texel, a thread to each of 64 slices along the ray through the
 * texel's centre (under an orthographic view, from the texel's own point, as the tracing's rays),
 * over the table's depth: each asks the material's empty-space output
 * (`CLOUD_MATERIAL_EMPTY_SPACE_WGSL`) at the centre of its froxel and, with the corners option, at
 * its eight corners, and keeps the greatest. A slice where the material says there is something
 * stores its own distance (moved by the slice bias), the others the whole depth; the nearest of
 * the slices is the texel's value.
 *
 * It runs with the trace's block (`cloudTrace`: the view's size and inverse view-projection, the
 * table's slice depth, depth and bias) and the material's bindings. `corners` is the corners option,
 * a constant of the program. Lengths are centimetres.
 */
const emptySpaceOwn = (corners: boolean) => `${CLOUD_TRACE_LAYOUT.wgsl}
@group(${G}) @binding(${CLOUD_EMPTY_SPACE_BINDING.block}) var<uniform> cloudTrace:CloudTraceBlock;${cloudMaterialBindings(G, CLOUD_EMPTY_SPACE_BINDING.material)}
@group(${G}) @binding(${CLOUD_EMPTY_SPACE_BINDING.table}) var tableOut:texture_storage_2d<${CLOUD_EMPTY_SPACE_FORMAT},write>;
const EMPTY_SPACE_CORNERS:bool=${corners};
const EMPTY_SPACE_SIDE:u32=${CLOUD_EMPTY_SPACE_SIDE}u;
const EMPTY_SPACE_SLICES:u32=${CLOUD_EMPTY_SPACE_SLICES}u;
/** The diagonal of a unit cube: a froxel's bounding sphere is half of it across. */
const EMPTY_SPACE_DIAGONAL:f32=1.73;
var<workgroup> frontKm:array<f32,${CLOUD_EMPTY_SPACE_SLICES}>;
/** The material's empty-space output at the point \`offset\` into the froxel of slice \`slice\` of the
 *  table's texel \`texel\`: the point at the froxel's distance on the ray through the texel. */
fn emptySpaceValue(texel:vec2u,slice:u32,offset:vec3f)->f32{
 let uv=(vec2f(texel)+offset.xy)/f32(EMPTY_SPACE_SIDE);
 let seen=cloudViewRay(uvToNdc(uv));
 if(frame.eye.w==0.0){cloudMoveOrigin(seen.origin);}
 let along=(f32(slice)+offset.z)*cloudTrace.empty.x;
 return cloudMaterialEmptySpace(seen.dir*along,0.5*cloudTrace.empty.x*EMPTY_SPACE_DIAGONAL);
}
@compute @workgroup_size(1,1,${CLOUD_EMPTY_SPACE_SLICES})
fn ${CLOUD_EMPTY_SPACE_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) lane:vec3u){
 cloudPointStart(cloudTrace.layer.xyz,cloudPlanetKm(cloudTrace.counts.w==1u,cloudTrace.sky.x));
 var value=emptySpaceValue(id.xy,lane.z,vec3f(0.5));
 if(EMPTY_SPACE_CORNERS){
  for(var x=0.0;x<=1.0;x+=1.0){
   for(var y=0.0;y<=1.0;y+=1.0){
    for(var z=0.0;z<=1.0;z+=1.0){value=max(value,emptySpaceValue(id.xy,lane.z,vec3f(x,y,z)));}
   }
  }
 }
 let startKm=(f32(lane.z)+cloudTrace.empty.z)*cloudTrace.empty.x*CLOUD_CM_TO_KM;
 frontKm[lane.z]=max(0.0,select(cloudTrace.empty.y*CLOUD_CM_TO_KM,startKm,value>0.0));
 workgroupBarrier();
 for(var stride=EMPTY_SPACE_SLICES/2u;stride>=1u;stride=stride/2u){
  if(lane.z<stride){frontKm[lane.z]=min(frontKm[lane.z],frontKm[lane.z+stride]);}
  workgroupBarrier();
 }
 if(lane.z==0u){textureStore(tableOut,id.xy,vec4f(frontKm[0],0.0,0.0,0.0));}
}`

/** The empty-space pass's whole program, with the corners option `corners`, the air's declarations
 *  written for `shape`. */
export const emptySpaceProgram = (corners: boolean, shape: AirShape = DEFAULT_AIR_SHAPE) =>
  airProgram(
    CLOUD_TRACE_AIR,
    emptySpaceOwn(corners),
    [CLOUD_POINT_WGSL, CLOUD_RAY_WGSL, CLOUD_MATERIAL_EMPTY_SPACE_WGSL, uvToNdc],
    shape,
  )
