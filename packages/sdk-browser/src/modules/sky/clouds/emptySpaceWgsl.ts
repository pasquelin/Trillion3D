import { pixelToNdc, unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import type { WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { airProgram } from '../../../lighting/atmosphere/programs.ts'
import { CLOUD_MATERIAL_EMPTY_SPACE_WGSL, cloudMaterialBindings } from './materialWgsl.ts'
import { CLOUD_TRACE_BINDING as B, CLOUD_TRACE_LAYOUT } from './traceLayout.ts'
import { CLOUD_EMPTY_SPACE_SIDE, CLOUD_EMPTY_SPACE_SLICES } from './traceOptions.ts'
import { CLOUD_TRACE_AIR } from './traceWgsl.ts'
import { CLOUD_POINT_WGSL } from './traceLightWgsl.ts'

/** The empty-space pass's own group: group 0 is the air's. */
const G = 1

/** Where the pass binds what it reads and writes in its group: the trace's block and the material
 *  where the trace binds them, and the table it writes. */
export const CLOUD_EMPTY_SPACE_BINDING = { material: B.material, block: B.block, table: 8 } as const

/** The table's format: one float, the distance in kilometres (a storage texture cannot be a half). */
export const CLOUD_EMPTY_SPACE_FORMAT: GPUTextureFormat = 'r32float'

export const CLOUD_EMPTY_SPACE_ENTRY = 'cloudEmptySpaceMain'

/**
 * THE EMPTY-SPACE TABLE: for each texel of a 32 by 32 table over the view, how far from the eye
 * the first cloud may be, in kilometres, so that the view tracing (`traceExtraWgsl.ts`) starts its
 * march there. One group to a texel, a thread to each of 64 slices along the ray through the
 * texel's centre, over the table's depth: each asks the material's empty-space output at the centre
 * of its froxel and, with the corners option, at its eight corners, and keeps the greatest. A slice
 * where the material says there is something stores its own distance (moved by the slice bias), the
 * others the whole depth; the nearest of the slices is the texel's value.
 *
 * It runs for a material that gives that output (\`CLOUD_MATERIAL_EMPTY_SPACE_WGSL\`, whose
 * \`cloudMaterialEmptySpace\` it reads), with the trace's block (\`cloudTrace\`: the view's size and
 * inverse view-projection, the table's slice depth, depth and bias) and the material's bindings.
 * \`EMPTY_SPACE_CORNERS\` is the corner option, a pipeline constant. Lengths are centimetres.
 */
const emptySpaceOwn = `${CLOUD_TRACE_LAYOUT.wgsl}
@group(${G}) @binding(${CLOUD_EMPTY_SPACE_BINDING.block}) var<uniform> cloudTrace:CloudTraceBlock;${cloudMaterialBindings(G, CLOUD_EMPTY_SPACE_BINDING.material)}
@group(${G}) @binding(${CLOUD_EMPTY_SPACE_BINDING.table}) var tableOut:texture_storage_2d<${CLOUD_EMPTY_SPACE_FORMAT},write>;
override EMPTY_SPACE_CORNERS:bool=true;
const EMPTY_SPACE_SIDE:u32=${CLOUD_EMPTY_SPACE_SIDE}u;
const EMPTY_SPACE_SLICES:u32=${CLOUD_EMPTY_SPACE_SLICES}u;
/** The diagonal of a unit cube: a froxel's bounding sphere is half of it across. */
const EMPTY_SPACE_DIAGONAL:f32=1.73;
var<workgroup> frontKm:array<f32,${CLOUD_EMPTY_SPACE_SLICES}>;
/** The material's empty-space output at the point \`offset\` into the froxel of slice \`slice\` of the
 *  table's texel \`texel\`: the point at the froxel's distance on the ray through the texel. */
fn emptySpaceValue(texel:vec2u,slice:u32,offset:vec3f)->f32{
 let view=vec2f(cloudTrace.view.xy);
 let uv=(vec2f(texel)+offset.xy)/f32(EMPTY_SPACE_SIDE);
 let ndc=pixelToNdc(uv*view,view);
 let dir=normalize(unprojectPoint(cloudTrace.inverseView,vec3f(ndc,0.5))-frame.eye.xyz);
 let distance=(f32(slice)+offset.z)*cloudTrace.empty.x;
 let at=cloudPointAt(dir*distance);
 return cloudMaterialEmptySpace(at,0.5*cloudTrace.empty.x*EMPTY_SPACE_DIAGONAL);
}
@compute @workgroup_size(1,1,${CLOUD_EMPTY_SPACE_SLICES})
fn ${CLOUD_EMPTY_SPACE_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) local:vec3u){
 cloudPointStart(cloudTrace.layer.xyz,cloudPlanetKm(cloudTrace.counts.w==1u,cloudTrace.sky.x));
 var value=emptySpaceValue(id.xy,local.z,vec3f(0.5));
 if(EMPTY_SPACE_CORNERS){
  for(var x=0.0;x<=1.0;x+=1.0){
   for(var y=0.0;y<=1.0;y+=1.0){
    for(var z=0.0;z<=1.0;z+=1.0){value=max(value,emptySpaceValue(id.xy,local.z,vec3f(x,y,z)));}
   }
  }
 }
 let startKm=(f32(local.z)+cloudTrace.empty.z)*cloudTrace.empty.x*CLOUD_CM_TO_KM;
 frontKm[local.z]=max(0.0,select(cloudTrace.empty.y*CLOUD_CM_TO_KM,startKm,value>0.0));
 workgroupBarrier();
 for(var half=EMPTY_SPACE_SLICES/2u;half>=1u;half=half/2u){
  if(local.z<half){frontKm[local.z]=min(frontKm[local.z],frontKm[local.z+half]);}
  workgroupBarrier();
 }
 if(local.z==0u){textureStore(tableOut,id.xy,vec4f(frontKm[0],0.0,0.0,0.0));}
}`

/** The empty-space pass's whole program, for a material that gives the output (\`output\`, its
 *  \`cloudMaterialEmptySpace\`): the default material gives none, and no program is made for it. */
export function emptySpaceProgram(output: WgslDecl | undefined = CLOUD_MATERIAL_EMPTY_SPACE_WGSL) {
  if (!output) throw new Error('The cloud material gives no empty-space output')
  return airProgram(CLOUD_TRACE_AIR, emptySpaceOwn, [
    CLOUD_POINT_WGSL,
    output,
    pixelToNdc,
    unprojectPoint,
  ])
}
