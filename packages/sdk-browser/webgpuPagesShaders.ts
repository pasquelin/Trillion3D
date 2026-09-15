import { DECLARED_LIGHTING_WGSL } from './directLightingWgsl.ts';
import { bounceApplyWgsl } from './bounceApplyWgsl.ts';
import { STANDARD_LIGHTING_WGSL, NORMAL_TRANSFORM_WGSL } from './standardLighting.ts';
import { TRIANGLE_PALETTE_WGSL } from './trianglePalette.ts';
import {
  ATLAS_SLOTS_WGSL,
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  atlasTextures,
} from './webgpuAtlasWgsl.ts';
import { BLEND_BINDINGS } from './webgpuBindLayout.ts';
import { FLAG_PAGED, FLAG_TRANSMISSIVE, FLAG_UNLIT_VIEW } from './visibilityBuffer.ts';
import { TRANSMISSION_WGSL } from './webgpuTransmissionWgsl.ts';

export const SHADER = `struct Uniforms{viewProj:mat4x4f,world:mat4x4f,color:vec4f,pageOffset:u32,indexCount:u32,mode:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) bary:vec3f,@location(2) view:vec3f,@location(3) @interpolate(flat) tri:u32,}
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32)->VSOut{
 var out:VSOut;
 if(vertexIndex>=uni.indexCount){out.position=vec4f(0.0,0.0,0.0,1.0);out.color=vec4f(0.0);out.bary=vec3f(0.0);out.view=vec3f(0.0);out.tri=0u;return out;}
 let id=indices[uni.pageOffset+vertexIndex];
 let world=uni.world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;out.color=uni.color;out.tri=0u;
 if(uni.mode==1u){out.tri=stableTriangleId(uni.pad1,vertexIndex/3u);}
 let corner=vertexIndex%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 return out;
}
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(c,vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}
${TRIANGLE_PALETTE_WGSL}
@fragment fn fs(in:VSOut)->@location(0) vec4f{
 if(uni.mode==1u){
  let width=fwidth(in.bary);
  let edge=1.0-min(min(smoothstep(0.0,width.x*1.2,in.bary.x),smoothstep(0.0,width.y*1.2,in.bary.y)),smoothstep(0.0,width.z*1.2,in.bary.z));
  return vec4f(mix(hashColor(in.tri),vec3f(0.04,0.05,0.07),edge),1.0);
 }
 return vec4f(linearToSrgb(aces(in.color.xyz)),1.0);
}
`;

export const BLEND_SHADER = `struct Uniforms{viewProj:mat4x4f,world:mat4x4f,color:vec4f,pageOffset:u32,indexCount:u32,mapIndex:u32,flags:u32,uvScale:vec2f,emissiveIndex:u32,alphaTest:f32,camPos:vec4f,roughness:f32,metalness:f32,normalScale:vec2f,roughIndex:u32,metalIndex:u32,normalIndex:u32,aoIndex:u32,aoIntensity:f32,emissiveR:f32,emissiveG:f32,emissiveB:f32,}
@group(0) @binding(${BLEND_BINDINGS.indices}) var<storage, read> indices:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.positions}) var<storage, read> positions:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uvs}) var<storage, read> uvs:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uniform}) var<uniform> uni:Uniforms;
${atlasTextures(BLEND_BINDINGS.maps, 'maps')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
${atlasTextures(BLEND_BINDINGS.dataMaps, 'dataMaps')}
@group(0) @binding(${BLEND_BINDINGS.normals}) var<storage,read> normals:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.scales}) var<storage,read> scales:array<vec4f>;
${STANDARD_LIGHTING_WGSL}
${DECLARED_LIGHTING_WGSL}
${bounceApplyWgsl(BLEND_BINDINGS.bounceGrid, BLEND_BINDINGS.probes)}
@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.shadowSlices}) var<storage,read> shadows:ShadowSlices;
@group(0) @binding(${BLEND_BINDINGS.shadowAtlas}) var shadowAtlas:texture_depth_2d;
@group(0) @binding(${BLEND_BINDINGS.shadowSampler}) var shadowSampler:sampler_comparison;
@group(0) @binding(${BLEND_BINDINGS.clusterDiagnostic}) var<storage,read> clusterDiagnostic:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.colorSlots}) var<storage,read> colorSlots:array<vec2u>;
@group(0) @binding(${BLEND_BINDINGS.dataSlots}) var<storage,read> dataSlots:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.clusterIds}) var<storage,read> clusterIds:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.clusterSpans}) var<storage,read> clusterSpans:array<vec2u>;
${TRANSMISSION_WGSL}
${ATLAS_SLOTS_WGSL}
${COLOR_SAMPLE_WGSL}
${DATA_SAMPLE_WGSL}
${NORMAL_TRANSFORM_WGSL}
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) uv:vec2f,@location(2) view:vec3f,@location(3) normal:vec3f,@location(4) tangent:vec3f,@location(5) bitangent:vec3f,@location(6) @interpolate(flat) tri:u32,@location(7) bary:vec3f,@location(8) @interpolate(flat) diagId:u32,}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(c,vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}
${TRIANGLE_PALETTE_WGSL}
// A paged transparent primitive draws one instance per cluster the GPU compaction kept, in the
// order the compaction wrote them, which is the source order the scene recorded. An unpaged one
// keeps its single instance over its own index buffer.
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->VSOut{
 var out:VSOut;
 var base=uni.pageOffset;
 var count=uni.indexCount;
 var clusterId=0u;
 if((uni.flags&${FLAG_PAGED}u)!=0u){
  let span=clusterSpans[clusterIds[uni.pageOffset+instance]];
  base=span.x;
  count=span.y;
  clusterId=clusterDiagnostic[clusterIds[uni.pageOffset+instance]];
 }
 if(vertexIndex>=count){out.position=vec4f(0.0,0.0,2.0,1.0);out.color=vec4f(0.0);out.uv=vec2f(0.0);out.view=vec3f(0.0);out.normal=vec3f(0.0,0.0,1.0);out.tangent=vec3f(0.0);out.bitangent=vec3f(0.0);out.tri=0u;out.bary=vec3f(0.0);out.diagId=0u;return out;}
 let id=indices[base+vertexIndex];
 let world=uni.world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;out.color=uni.color;
 out.tri=0u;
 out.diagId=0u;
 if((uni.flags&0x1c000000u)!=0u){out.diagId=clusterId;}
 if((uni.flags&0x20000000u)!=0u){
  let triangle=base+(vertexIndex/3u)*3u;
  let a=triangleHash(indices[triangle]);let b=triangleHash(indices[triangle+1u]);let c=triangleHash(indices[triangle+2u]);
  out.tri=a^((b<<1u)|(b>>31u))^((c<<2u)|(c>>30u));
 }
 let corner=vertexIndex%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 out.normal=vec3f(0.0);
 if((uni.flags&16u)!=0u){out.normal=xformNormal(uni.world,vec3f(normals[id*7u],normals[id*7u+1u],normals[id*7u+2u]));}
 out.tangent=vec3f(0.0);out.bitangent=vec3f(0.0);
 if((uni.flags&256u)!=0u){out.normal=-out.normal;}
 if((uni.flags&2048u)!=0u){
  out.tangent=normalize((uni.world*vec4f(normals[id*7u+3u],normals[id*7u+4u],normals[id*7u+5u],0.0)).xyz);
  if((uni.flags&256u)!=0u){out.tangent=-out.tangent;}
  out.bitangent=normalize(cross(out.normal,out.tangent)*normals[id*7u+6u]);
 }
 let i=id*2u;out.uv=vec2f(uvs[i],uvs[i+1u]);
 return out;
}
@fragment fn fs(in:VSOut,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);
 let q0=dpdx(in.view);let q1=dpdy(in.view);
 var N=normalize(-cross(q0,q1));
 if((uni.flags&16u)!=0u){N=normalize(in.normal);}
 let face=select(-1.0,1.0,front);
 if((uni.flags&2u)!=0u){N*=face;}
 let wrapped=vec2f(wrapCoord(in.uv.x,(uni.flags&32u)!=0u),wrapCoord(in.uv.y,(uni.flags&64u)!=0u));
 let sample=colorSample(uni.mapIndex,uni.uvScale,wrapped,gradX,gradY);
 let alpha=sample.w*in.color.w;
 if((uni.flags&0x40000000u)!=0u){
  if(alpha<=0.01||alpha<uni.alphaTest){discard;}
  var color=vec3f(0.204,0.827,0.6);
  if((uni.flags&0x20000000u)!=0u){
   let width=fwidth(in.bary);
   let edge=1.0-min(min(smoothstep(0.0,width.x*1.2,in.bary.x),smoothstep(0.0,width.y*1.2,in.bary.y)),smoothstep(0.0,width.z*1.2,in.bary.z));
   color=mix(hashColor(in.tri),vec3f(0.04,0.05,0.07),edge);
  }else if((uni.flags&0x10000000u)!=0u){color=select(vec3f(0.5,0.55,0.6),hashColor(in.diagId&0x00ffffffu),in.diagId!=0u);}
  else if((uni.flags&0x08000000u)!=0u){color=select(vec3f(0.04,0.51,0.94),vec3f(0.95,0.42,0.05),(in.diagId&0x80000000u)!=0u);}
  else if((uni.flags&0x04000000u)!=0u){let ratio=f32((in.diagId>>24u)&127u)/127.0;color=vec3f(ratio,1.0-ratio,0.12);}
  return vec4f(color,1.0);
 }
 var rgb=in.color.xyz*sample.xyz;
 // La teinte du matériau avant tout éclairage : c'est elle qui colore le fond qu'une surface
 // transmissive laisse voir, jamais la couleur déjà éclairée.
 let baseTint=rgb;
 var rough=uni.roughness;var metal=uni.metalness;var ao=1.0;
 if(uni.roughIndex!=0u){rough*=dataSample(uni.roughIndex,scales[uni.roughIndex].xy,wrapped,gradX,gradY).g;}
 if(uni.metalIndex!=0u){metal*=dataSample(uni.metalIndex,scales[uni.metalIndex].xy,wrapped,gradX,gradY).b;}
 if(uni.aoIndex!=0u){ao+=uni.aoIntensity*(dataSample(uni.aoIndex,scales[uni.aoIndex].xy,wrapped,gradX,gradY).r-1.0);}
 if(uni.normalIndex!=0u){
  let mapN=dataSample(uni.normalIndex,scales[uni.normalIndex].xy,wrapped,gradX,gradY).xyz*2.0-vec3f(1.0);
  var T=-(cross(q1,N)*gradX.x+cross(N,q0)*gradY.x);
  var B=-(cross(q1,N)*gradX.y+cross(N,q0)*gradY.y);
  if((uni.flags&2048u)!=0u){T=normalize(in.tangent);B=normalize(in.bitangent);}
  if((uni.flags&2u)!=0u){T*=face;B*=face;}
  let tbnScale=inverseSqrt(max(max(dot(T,T),dot(B,B)),1e-20));
  N=normalize(T*tbnScale*mapN.x*uni.normalScale.x+B*tbnScale*mapN.y*uni.normalScale.y+N*mapN.z);
 }
 var emissive=vec3f(uni.emissiveR,uni.emissiveG,uni.emissiveB);
 if(uni.emissiveIndex!=0u){emissive*=colorSample(uni.emissiveIndex,scales[uni.emissiveIndex].zw,wrapped,gradX,gradY).rgb;}
 if(alpha<uni.alphaTest){discard;}
 // Aucune lampe déclarée, ou vue sans éclairage demandée : l'albédo brut, exactement comme la
 // résolution opaque. Ni ambiance, ni ciel, ni soleil par défaut (P6).
 let unlit=(uni.flags&${FLAG_UNLIT_VIEW}u)!=0u;
 let V=normalize(uni.camPos.xyz-in.view);
 let clamped=clamp(rough,0.0525,1.0);
 if(!unlit&&(uni.flags&1u)!=0u){
  let m=clamp(metal,0.0,1.0);
  rgb=declaredLighting(rgb,m,clamped,N,V,in.view,ao)+bounceLighting(rgb,m,N,in.view,ao)+emissive;
 }
 // La classe 3 relit le fond figé au lieu de le mélanger par alpha. Le drapeau vient du matériau,
 // et cette passe est la seule à le porter : une vue sans éclairage transmet toujours ce qu'elle
 // voit derrière, elle ne l'éclaire simplement pas.
 if((uni.flags&${FLAG_TRANSMISSIVE}u)!=0u){
  return transmissionColor(rgb,baseTint,alpha,N,V,in.view,in.position.xy,in.position.z,clamped,ao,unlit);
 }
 return vec4f(rgb,alpha);
}
`;
