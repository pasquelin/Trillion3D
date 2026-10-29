import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PT_AIR_DEPTH_FORMAT, PT_AIR_MEDIUM_WGSL, PT_AIR_STRUCT } from './airMediumWgsl.ts'

/** The entry of the kernel that integrates the air's optical depth, and the bindings of its group: the atmosphere's block, the table written, the parameters (the table's side, the samples a texel integrates, the first row and the rows of the slice). */
export const PT_AIR_DEPTH_ENTRY = 'ptAirDepthBuild'
export const PT_AIR_DEPTH_BINDINGS = { atmosphere: 0, table: 1, params: 2 } as const

/** The bytes between two blocks of the kernel's parameters: a uniform's offset alignment. */
export const PT_AIR_DEPTH_BLOCK = 256

const B = PT_AIR_DEPTH_BINDINGS

/**
 * THE AIR'S OPTICAL DEPTH TABLE (`ptAirDepthBuild`): for each texel, a ray at the height and the zenith cosine the texel stands for (`ptAirLutFromUv`) goes through the air to its top on the far side of the planet,
 * and the table keeps the integral of the extinction along it (a quantity with no unit, kept in place of the transmittance so that the differences of two points of a ray lose no precision). A ray that meets the ground
 * integrates the part above it and the part beyond the planet numerically and the part through the planet, which is homogeneous, analytically. The table is made in slices of rows, one dispatch each, so that no dispatch runs long.
 */
const PT_AIR_DEPTH_KERNEL_WGSL = wgslBlock(
  'PT_AIR_DEPTH_KERNEL_WGSL',
  [PT_AIR_MEDIUM_WGSL],
  `struct PtAirDepthParams{size:u32,samples:u32,row:u32,rows:u32,}
@group(0) @binding(${B.params}) var<uniform> ptAirDepthParams:PtAirDepthParams;
fn ptAirExtinctionAtRatio(h:f32,c:f32,rs:f32)->vec3f{
 let height=h*sqrt(1.0+rs*rs+2.0*c*rs);
 return ptAirMediumAt(height-ptAirBottom()).extinction;
}
@compute @workgroup_size(8,8,1)
fn ${PT_AIR_DEPTH_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let size=ptAirDepthParams.size;
 let texel=vec2u(id.x,id.y+ptAirDepthParams.row);
 if(id.x>=size||id.y>=ptAirDepthParams.rows||texel.y>=size){return;}
 let hc=ptAirLutFromUv((vec2f(texel)+0.5)/f32(size));
 let h=hc.x;
 let c=hc.y;
 let top=ptAirTop();
 let bottom=ptAirBottom();
 let rt=top/h;
 let rb=bottom/h;
 let deltaT=rt*rt+(c*c-1.0);
 let deltaB=rb*rb+(c*c-1.0);
 let rsT=-c+sqrt(max(deltaT,0.0));
 let rsB0=-c-sqrt(max(deltaB,0.0));
 let rsB1=-c+sqrt(max(deltaB,0.0));
 var tau=vec3f(0.0);
 if(deltaB>0.0&&c<0.0){
  let first=ptAirDepthParams.samples/2u;
  let second=ptAirDepthParams.samples-first;
  let drs0=rsB0/f32(first);
  for(var i=0u;i<first;i++){tau+=ptAirExtinctionAtRatio(h,c,(f32(i)+0.5)*drs0)*(drs0*h);}
  tau+=h*(rsB1-rsB0)*ptAirMediumAt(0.0).extinction;
  let drs1=(rsT-rsB1)/f32(second);
  for(var i=0u;i<second;i++){tau+=ptAirExtinctionAtRatio(h,c,rsB1+(f32(i)+0.5)*drs1)*(drs1*h);}
 }else{
  let drs=rsT/f32(ptAirDepthParams.samples);
  for(var i=0u;i<ptAirDepthParams.samples;i++){tau+=ptAirExtinctionAtRatio(h,c,(f32(i)+0.5)*drs)*(drs*h);}
 }
 textureStore(ptAirDepthOut,vec2i(texel),vec4f(tau,0.0));
}`,
)

/** The program that makes the table. */
export const PT_AIR_DEPTH_WGSL = wgslProgram(
  `${PT_AIR_STRUCT}
@group(0) @binding(${B.atmosphere}) var<uniform> ptAtmo:PtAtmo;
@group(0) @binding(${B.table}) var ptAirDepthOut:texture_storage_2d<${PT_AIR_DEPTH_FORMAT},write>;`,
  [PT_AIR_DEPTH_KERNEL_WGSL],
)
