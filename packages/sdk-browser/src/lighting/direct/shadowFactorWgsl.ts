import { POINT_FACES } from '../../../../sdk-core/src/index.ts';
import {
  LAMP_FACE_ENTRIES,
  LAMP_MIPS,
  POOL_SIDE,
  SUN_LEVELS,
  SUN_LEVEL_ENTRIES,
  SUN_WINDOW,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/**
 * Which page a lit point reads, and the fraction of light that reaches it.
 *
 * **The level is chosen per pixel from its footprint** — the world distance between two
 * adjacent pixels at its depth, `shadowFootprint`: a sun reads the clipmap level whose texel,
 * `2^L` metres, is at most that footprint; a lamp reads the mip whose texel at the point's
 * distance is. A texel is thus never larger than a pixel where the map can offer it, near or
 * far, and a caster's error counted in texels is counted in pixels. A page not readable yet hands
 * the point to the next coarser level, as the texture streamer falls back to a coarser tile;
 * beyond a sun's last level, the far-shadow ray answers.
 *
 * The read point moves along the normal by a texel of the level read, divided by the incidence
 * cosine: that closes the seam between two faces of a point light and removes grazing acne.
 */
export const SHADOW_FACTOR_WGSL = `
const SUN_LEVEL_COUNT:i32=${SUN_LEVELS};
const SUN_LEVEL_WORDS:u32=${SUN_LEVEL_ENTRIES}u;
const SUN_WINDOW_PAGES:i32=${SUN_WINDOW};
const LAMP_PAGE_COUNT:u32=${POOL_SIDE}u;
const LAMP_MIP_COUNT:u32=${LAMP_MIPS}u;
const LAMP_FACE_WORDS:u32=${LAMP_FACE_ENTRIES}u;
/** Window origin of clipmap slot \`slot\` of record \`index\`. */
fn sunOrigin(index:u32,slot:i32)->vec2i{
 let pair=shadows.records[index].origins[slot/2];
 return select(pair.xy,pair.zw,(slot&1)!=0);
}
fn sunShadowFactor(index:u32,P:vec3f,N:vec3f)->f32{
 // Field by field: a record is six matrices wide, and the sun reads none of them.
 let f0=shadows.records[index].frame[0];let f1=shadows.records[index].frame[1];
 let right=f0.xyz;let up=f1.xyz;let axis=shadows.records[index].frame[2].xyz;
 let zNear=f0.w;let depth=max(f1.w-zNear,1e-6);
 let info=shadows.records[index].info;
 let finest=i32(info.y);let last=finest+i32(info.x);
 let cosine=clamp(dot(N,-axis),1e-3,1.0);
 for(var level=max(i32(floor(log2(max(shadowFootprint,1e-30)))),finest);level<last;level++){
  let texel=exp2(f32(level));
  let page=texel*SHADOW_PAGE;
  let slot=shadowRing(level,SUN_LEVEL_COUNT);
  let origin=sunOrigin(index,slot);
  let Q=P+N*texel*SHADOW_NORMAL_TEXELS/max(cosine,0.2);
  // Relative to the window's first page, whose world offset is exact in single precision.
  let t=vec2f(dot(Q,right)-f32(origin.x)*page,-dot(Q,up)-f32(origin.y)*page)/texel;
  let map=ShadowMap(u32(info.w)+u32(slot)*SUN_LEVEL_WORDS,1u,SUN_WINDOW_PAGES,origin.x,origin.y);
  let home=vec2i(floor(t/SHADOW_PAGE));
  let word=shadowPageWord(map,home);
  if(word==0u){continue;}
  let reference=1.0-(dot(Q,axis)-zNear)/depth+shadowBiasMetres(cosine)/depth;
  return shadowPcf(map,t,reference,home,word,0.0);
 }
 return sunFarShadowFactor(P,N,-axis);
}
fn lampShadowFactor(index:u32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f)->f32{
 let info=shadows.records[index].info;
 let face=select(0u,pointFaceOf(P-light.positionRange.xyz),u32(info.x)==${POINT_FACES}u);
 let m=shadows.records[index].faces[face];
 let cosine=clamp(dot(N,L),1e-3,1.0);
 let radius=length(light.positionRange.xyz-P);
 // World texel of the finest mip at this distance, and the mip whose texel the pixel covers.
 let texel0=2.0*info.y*radius/(f32(LAMP_PAGE_COUNT)*SHADOW_PAGE);
 let wanted=clamp(floor(log2(max(shadowFootprint/texel0,1.0))),0.0,f32(LAMP_MIP_COUNT-1u));
 let near=info.z;
 let far=max(near*1.001,light.positionRange.w);
 for(var mip=u32(wanted);mip<LAMP_MIP_COUNT;mip++){
  let pages=LAMP_PAGE_COUNT>>mip;
  let side=f32(pages)*SHADOW_PAGE;
  let texel=texel0*exp2(f32(mip));
  let clip=m*vec4f(P+N*texel*SHADOW_NORMAL_TEXELS/max(cosine,0.2),1.0);
  if(clip.w<=0.0){return 1.0;}
  let ndc=clip.xyz/clip.w;
  if(abs(ndc.x)>1.0||abs(ndc.y)>1.0||ndc.z<0.0||ndc.z>1.0){return 1.0;}
  let t=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*side;
  let map=ShadowMap(u32(info.w)+face*LAMP_FACE_WORDS+LAMP_MIP_OFFSET[mip],0u,i32(pages),0,0);
  let home=clamp(vec2i(floor(t/SHADOW_PAGE)),vec2i(0),vec2i(i32(pages)-1));
  let word=shadowPageWord(map,home);
  if(word==0u){continue;}
  // These metres become a depth margin at the point: dz/dd of a perspective projection is
  // near·far/((far−near)·d²), so the margin follows the distance to the light.
  let scale=near*far/((far-near)*max(clip.w*clip.w,1e-4));
  return shadowPcf(map,t,ndc.z+shadowBiasMetres(cosine)*scale,home,word,side);
 }
 return 1.0;
}
/** Fraction of light that reaches the point: 1 in full light, 0 fully in shadow. */
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f)->f32{
 if(slice<0){return 1.0;}
 let index=u32(slice);
 if(shadows.records[index].info.x<0.5){return 1.0;}
 if(isSun(light)){return sunShadowFactor(index,P,N);}
 return lampShadowFactor(index,light,P,N,L);
}`;
