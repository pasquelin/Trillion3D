import { ACES_WGSL } from './toneMappingWgsl.ts';
import { TRIANGLE_PALETTE_WGSL } from './trianglePalette.ts';
import { clusterDecodeWgsl } from './clusterDecodeWgsl.ts';

/** `mode`: bit 0 draws the triangle diagnostic, bit 1 says the slot holds a quantized cluster
 *  page and the draw decodes its corners from it instead of reading the float positions. */
export const FALLBACK_WIREFRAME = 1,
  FALLBACK_CLUSTER_PAGE = 2;

export const SHADER = `struct Uniforms{viewProj:mat4x4f,world:mat4x4f,color:vec4f,pageOffset:u32,indexCount:u32,mode:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
${clusterDecodeWgsl('indices')}
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) bary:vec3f,@location(2) view:vec3f,@location(3) @interpolate(flat) tri:u32,}
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32)->VSOut{
 var out:VSOut;
 if(vertexIndex>=uni.indexCount){out.position=vec4f(0.0,0.0,0.0,1.0);out.color=vec4f(0.0);out.bary=vec3f(0.0);out.view=vec3f(0.0);out.tri=0u;return out;}
 var local=vec3f(0.0);
 if((uni.mode&${FALLBACK_CLUSTER_PAGE}u)!=0u){
  let h=clusterHeader(uni.pageOffset);
  local=clusterPosition(h,uni.pageOffset,clusterIndex(h,uni.pageOffset,vertexIndex));
 }else{
  let id=indices[uni.pageOffset+vertexIndex];
  local=vec3f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u]);
 }
 let world=uni.world*vec4f(local,1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;out.color=uni.color;out.tri=0u;
 if((uni.mode&${FALLBACK_WIREFRAME}u)!=0u){out.tri=stableTriangleId(uni.pad1,vertexIndex/3u);}
 let corner=vertexIndex%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 return out;
}${ACES_WGSL}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(c,vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}
${TRIANGLE_PALETTE_WGSL}
@fragment fn fs(in:VSOut)->@location(0) vec4f{
 if((uni.mode&${FALLBACK_WIREFRAME}u)!=0u){
  let width=fwidth(in.bary);
  let edge=1.0-min(min(smoothstep(0.0,width.x*1.2,in.bary.x),smoothstep(0.0,width.y*1.2,in.bary.y)),smoothstep(0.0,width.z*1.2,in.bary.z));
  return vec4f(mix(hashColor(in.tri),vec3f(0.04,0.05,0.07),edge),1.0);
 }
 return vec4f(linearToSrgb(aces(in.color.xyz)),1.0);
}
`;
