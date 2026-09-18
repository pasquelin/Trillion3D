import { INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import { TRIANGLE_PALETTE_WGSL } from './trianglePalette.ts';
import {
  BARY_WEIGHTS_WGSL,
  EDGE_WGSL,
  PAGE_INFO_STRUCT_WGSL,
  PAGE_UV_WGSL,
  PAGE_VERTEX_WGSL,
} from './visibilityPageWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  feedbackDeclaration,
  tileDeclarations,
} from './webgpuTileWgsl.ts';
import { TILE_FEEDBACK_WGSL } from './webgpuTileRequestWgsl.ts';
import { SHADE_SHADOW_REQUEST_WGSL, SHADOW_REQUEST_WRAP } from './visibilityShaderShadowRequest.ts';
import { SHADOW_SLICE_WGSL } from './directShadowWgsl.ts';
import { SHADE_BINDINGS } from './webgpuBindLayout.ts';
import { lecture, retour, siCarte } from './visibilityShaderMaps.ts';

export const SHADE_SHADER = `${PAGE_INFO_STRUCT_WGSL}
${SHADOW_SLICE_WGSL}
struct ShadeUni{viewProj:mat4x4f,viewport:vec4f,pageCount:u32,mode:u32,feedback:u32,pad1:u32,sun:ShadowSlice,}
@group(0) @binding(${SHADE_BINDINGS.visView}) var vis:texture_2d<u32>;
@group(0) @binding(${SHADE_BINDINGS.cache}) var<storage, read> indices:array<u32>;
@group(0) @binding(${SHADE_BINDINGS.position}) var<storage, read> positions:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.normal}) var<storage, read> normals:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.pageTable}) var<storage, read> pages:array<PageInfo>;
${tileDeclarations(SHADE_BINDINGS.color, 'color')}
@group(0) @binding(${SHADE_BINDINGS.sampler}) var mapsSampler:sampler;
@group(0) @binding(${SHADE_BINDINGS.uniform}) var<uniform> uni:ShadeUni;
${tileDeclarations(SHADE_BINDINGS.data, 'data')}
${feedbackDeclaration(SHADE_BINDINGS.feedback)}
${TRIANGLE_PALETTE_WGSL}
${PAGE_VERTEX_WGSL}
${PAGE_UV_WGSL}
fn vertN(base:u32,idx:u32)->vec3f{let i=(base+idx)*7u;return vec3f(normals[i],normals[i+1u],normals[i+2u]);}
fn vertT(base:u32,idx:u32)->vec4f{let i=(base+idx)*7u+3u;return vec4f(normals[i],normals[i+1u],normals[i+2u],normals[i+3u]);}
${EDGE_WGSL}
${BARY_WEIGHTS_WGSL}
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${DATA_SAMPLE_WGSL}
${TILE_FEEDBACK_WGSL}
${SHADE_SHADOW_REQUEST_WGSL}
${INVERSE_TRANSPOSE_WGSL}
struct SurfaceOut{@location(0) baseMetal:vec4f,@location(1) normalRough:vec4f,@location(2) emissiveAo:vec4f,@location(3) flags:u32,}
fn emptySurface()->SurfaceOut{return SurfaceOut(vec4f(0.0),vec4f(0.0),vec4f(0.0),0u);}
fn diagnosticSurface(color:vec3f)->SurfaceOut{return SurfaceOut(vec4f(color,0.0),vec4f(0.0),vec4f(0.0),3u);}
fn framebuffer(clip:vec4f)->vec3f{
 let ndc=clip.xyz/clip.w;
 return vec3f((ndc.x*0.5+0.5)*uni.viewport.x,(-ndc.y*0.5+0.5)*uni.viewport.y,ndc.z);
}
@vertex fn shade_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let x=f32(i32(i&1u)*4-1);let y=f32(i32(i>>1u)*4-1);return vec4f(x,y,0.0,1.0);
}
@fragment fn shade_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 let coord=vec2<i32>(i32(pos.x),i32(pos.y));
 let id=textureLoad(vis,coord,0).r;
 if(id==0u){return emptySurface();}
 let pageIndex=(id>>8u)-1u;let tri=id&0xffu;
 if(pageIndex>=uni.pageCount){return emptySurface();}
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount){return emptySurface();}
 let base=page.pageOffset+tri*3u;
 let i0=indices[base];let i1=indices[base+1u];let i2=indices[base+2u];
 let p0=vertPos(page.vertexBase,i0);let p1=vertPos(page.vertexBase,i1);let p2=vertPos(page.vertexBase,i2);
 let w0=page.world*vec4f(p0,1.0);let w1=page.world*vec4f(p1,1.0);let w2=page.world*vec4f(p2,1.0);
 let c0=uni.viewProj*w0;let c1=uni.viewProj*w1;let c2=uni.viewProj*w2;
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let p=vec2f(pos.x,pos.y);
 let area=edge(s1.xy,s2.xy,s0.xy);
 var rgb=page.baseColor.xyz;
 var bary=vec3f(0.333,0.333,0.334);
 var uv=vec2f(0.0);
 if(area!=0.0){
  let bw=baryWeights(s0.xy,s1.xy,s2.xy,p,area);let a0=bw.x;let a1=bw.y;let a2=bw.z;
  let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
  let p0w=a0*iw0;let p1w=a1*iw1;let p2w=a2*iw2;let sum=p0w+p1w+p2w;
  bary=select(vec3f(a0,a1,a2),vec3f(p0w,p1w,p2w)/sum,sum!=0.0);
 }
 let absArea=abs(area);
 let width=select(vec3f(0.005),vec3f(abs(s1.y-s2.y)+abs(s2.x-s1.x),abs(s2.y-s0.y)+abs(s0.x-s2.x),abs(s0.y-s1.y)+abs(s1.x-s0.x))/absArea,absArea>0.0);
 var ddx=vec2f(0.0);var ddy=vec2f(0.0);
 if((page.flags&4u)!=0u){
  uv=vertUv(page.vertexBase,i0)*bary.x+vertUv(page.vertexBase,i1)*bary.y+vertUv(page.vertexBase,i2)*bary.z;
 }
 if((page.flags&4u)!=0u){
  let uva=vertUv(page.vertexBase,i0);let uvb=vertUv(page.vertexBase,i1);let uvc=vertUv(page.vertexBase,i2);
  let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
  if(det!=0.0){
   let inv=1.0/det;let dsdx=dyc*inv;let dsdy=-dxc*inv;let dtdx=-dyb*inv;let dtdy=dxb*inv;
   let s=((p.x-s0.x)*dyc-(p.y-s0.y)*dxc)*inv;let t=((p.y-s0.y)*dxb-(p.x-s0.x)*dyb)*inv;let a0=1.0-s-t;
   let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
   let U=a0*uva*iw0+s*uvb*iw1+t*uvc*iw2;let W=a0*iw0+s*iw1+t*iw2;
   if(W!=0.0){
    let dUds=-uva*iw0+uvb*iw1;let dUdt=-uva*iw0+uvc*iw2;let dWds=-iw0+iw1;let dWdt=-iw0+iw2;
    let dUdx=dUds*dsdx+dUdt*dtdx;let dUdy=dUds*dsdy+dUdt*dtdy;let dWdx=dWds*dsdx+dWdt*dtdx;let dWdy=dWds*dsdy+dWdt*dtdy;
    ddx=(dUdx*W-U*dWdx)/(W*W);ddy=(dUdy*W-U*dWdy)/(W*W);
   }
  }
 }
 if(feedbackPhase(pos.xy,uni.feedback)){
  ${retour}
  if((page.flags&12u)==12u){let s=colorSlot(page.mapIndex);shadowRequests(page,s,slotWrapped(s,uv,${SHADOW_REQUEST_WRAP}),w0,w1,w2,i0,i1,i2,w0*bary.x+w1*bary.y+w2*bary.z);}
 }
 let sample=${lecture('colorSample', 'base')};
 var roughSample=vec4f(1.0);
 ${siCarte('rough', `roughSample=${lecture('dataSample', 'rough')};`)}
 var metalSample=vec4f(1.0);
 ${siCarte('metal', `metalSample=${lecture('dataSample', 'metal')};`)}
 var ao=1.0;
 ${siCarte('ao', `ao=1.0+page.aoIntensity*(${lecture('dataSample', 'ao')}.r-1.0);`)}
 var emissive=page.emissive.xyz;
 ${siCarte('emissive', `emissive*=${lecture('colorSample', 'emissive')}.rgb;`)}
 var nrmSample=vec4f(0.5,0.5,1.0,1.0);
 ${siCarte('normal', `nrmSample=${lecture('dataSample', 'normal')};`)}
 if((page.flags&8u)!=0u){
  rgb=rgb*sample.xyz;
  if((page.flags&128u)!=0u&&sample.w<page.baseColor.w){return emptySurface();}
 }
 if(uni.mode==1u){
  let edgeW=1.0-min(min(smoothstep(0.0,width.x*1.2,bary.x),smoothstep(0.0,width.y*1.2,bary.y)),smoothstep(0.0,width.z*1.2,bary.z));
  return diagnosticSurface(mix(hashColor(stableTriangleId(page.clusterHash,tri)),vec3f(0.04,0.05,0.07),edgeW));
 }
 if(uni.mode==2u){return diagnosticSurface(hashColor(page.clusterHash));}
 if(uni.mode==3u){return diagnosticSurface(vec3f(0.204,0.827,0.6));}
 if(uni.mode==4u){return diagnosticSurface(select(vec3f(0.04,0.51,0.94),vec3f(0.95,0.42,0.05),page.pad1>0.5));}
 if(uni.mode==5u){return diagnosticSurface(vec3f(0.204,0.827,0.6));}
 if(uni.mode==6u){let ratio=clamp(page.pad4.x,0.0,1.0);return diagnosticSurface(vec3f(ratio,1.0-ratio,0.12));}
 var metal=clamp(page.metalness*metalSample.z,0.0,1.0);var rough=clamp(page.roughness*roughSample.y,0.0525,1.0);
 // Original vertices may straddle the near plane; recover the clipped winding.
  let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
  let world3=mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz);
  // Le sens de face d'une pose singulière ne vient PAS de son déterminant nul : sur une face
  // aplatie, l'adjointe a déjà mis la normale du côté du produit vectoriel des arêtes transformées,
  // et il ne reste que le côté d'où l'écran la voit. Le test de déterminant ci-dessous rend
  // exactement cela à déterminant nul — face y vaut screenFace —, comme matrixWindingCw côté CPU.
  let face=screenFace*select(-1.0,1.0,determinant(world3)>=0.0);
  let side=select(1.0,-1.0,(page.flags&256u)!=0u);
  // Les trois normales du triangle subissent la MÊME matrice : la normalisation, le déterminant et
  // l'adjointe se calculent une fois pour le pixel, et chaque normale ne garde que le produit 3×3.
  // xformNormal faisait ce prologue trois fois ; l'opérande et l'ordre par normale ne bougent pas.
  // uniteOuZero rend normalize sur tout vecteur non nul, donc les mêmes bits qu'avant sur une pose
  // régulière ; il ne diffère que là où normalize rendrait NaN — face effondrée, triangle dégénéré.
  // Sur une pose de rang 2, invTranspose3Apply rend la normale de la FACE transformée : les trois
  // normales de sommets y tombent sur la même direction, et l'interpolation la conserve.
  let invT=invTranspose3Prep(world3);
  var n0=uniteOuZero(invTranspose3Apply(invT,vertN(page.vertexBase,i0)))*side;
  var n1=uniteOuZero(invTranspose3Apply(invT,vertN(page.vertexBase,i1)))*side;
  var n2=uniteOuZero(invTranspose3Apply(invT,vertN(page.vertexBase,i2)))*side;
  var N=uniteOuZero(cross((w1-w0).xyz,(w2-w0).xyz))*screenFace;
  if((page.flags&16u)!=0u){
   N=uniteOuZero(n0*bary.x+n1*bary.y+n2*bary.z);
   if((page.flags&2u)!=0u){N*=face;}
  }
  if(page.normalIndex!=0u){
   let nrm=nrmSample.xyz*2.0-vec3f(1.0);
   let mapN=vec3f(nrm.x*page.normalScale,nrm.y*page.normalScaleY,nrm.z);
   var T=vec3f(0.0);var B=vec3f(0.0);
   if((page.flags&2048u)!=0u){
    let ta=vertT(page.vertexBase,i0);let tb=vertT(page.vertexBase,i1);let tc=vertT(page.vertexBase,i2);
    let t0=normalize(world3*ta.xyz)*side;let t1=normalize(world3*tb.xyz)*side;let t2=normalize(world3*tc.xyz)*side;
    T=normalize(t0*bary.x+t1*bary.y+t2*bary.z);
    B=normalize(normalize(cross(n0,t0)*ta.w)*bary.x+normalize(cross(n1,t1)*tb.w)*bary.y+normalize(cross(n2,t2)*tc.w)*bary.z);
   }else{
    let e1=(w1-w0).xyz;let e2=(w2-w0).xyz;
    let uva=vertUv(page.vertexBase,i0);let uvb=vertUv(page.vertexBase,i1);let uvc=vertUv(page.vertexBase,i2);
    let duv1=uvb-uva;let duv2=uvc-uva;
    T=(cross(e2,N)*duv1.x+cross(N,e1)*duv2.x)*screenFace;
    B=(cross(e2,N)*duv1.y+cross(N,e1)*duv2.y)*screenFace;
    let scale=inverseSqrt(max(max(dot(T,T),dot(B,B)),1e-20));T*=scale;B*=scale;
   }
   if((page.flags&2u)!=0u&&(page.flags&16u)!=0u){T*=face;B*=face;}
   N=uniteOuZero(T*mapN.x+B*mapN.y+N*mapN.z);
  }
 return SurfaceOut(vec4f(rgb,metal),vec4f(N,rough),vec4f(emissive,ao),select(1u,2u,(page.flags&1u)!=0u));
}
`;
