import { FLAG_SAMPLED } from '../../visibility/types.ts';
import { COTANGENT_FRAME_WGSL } from '../../cluster/decodeWgsl.ts';
import { FACING_SHIFT } from './facing.ts';

/** The pixel's footprint at lit point \`P\`, in metres: what the blend's shadow reads at
 *  (\`shadowFootprint\`), and the level its marks ask for (\`marksWgsl.ts\`). */
export const BLEND_SHADOW_FOOTPRINT_WGSL = `fn blendShadowFootprint(P:vec3f)->f32{return select(uni.pixelScale,uni.pixelScale*length(uni.camPos.xyz-P),uni.camPos.w!=0.0);}`;

export const BLEND_SURFACE_NORMAL_WGSL = `/** The normal before any normal map: the vertex attribute, turned on the back of a two-sided
 *  material, or the face's own from screen derivatives \`q0\`, \`q1\` of the point. What the blend
 *  stage bends by its map (\`blendSurface\`) and the shadow marks read as is (\`marksWgsl.ts\`). */
fn blendGeometricNormal(in:VSOut,front:bool,q0:vec3f,q1:vec3f)->vec3f{
 // uniteOuZero yields normalize wherever the vector is not null: same bits as before on an
 // ordinary surface, a null vector — and not NaN — on a collapsed face, whose a NaN would win
 // neighbouring pixels through screen derivatives. A rank-2 pose does not arrive there null:
 // xformNormal already gave it the flattened face's normal.
 // The geometric normal comes from screen derivatives: it already looks at the observer, whatever
 // the rasterised face. Only a vertex normal, which points toward the declared outside, flips on
 // the back of a two-sided material — flipping it too would send the geometric one opposite the
 // light, and the surface would render exactly zero. Same rule as the opaque resolve, which only
 // flips the interpolated normal.
 if((in.ids.y&16u)==0u){return uniteOuZero(-cross(q0,q1));}
 return uniteOuZero(in.normal.xyz)*select(1.0,select(-1.0,1.0,front),(in.ids.y&2u)!=0u);
}`;

/**
 * What a transparent fragment reads on its material, before any lighting: base colour and
 * opacity, the normal — from the vertex attribute, from screen derivatives, then bent by the
 * normal map in the cotangent frame the opaque resolve uses —, roughness, metalness, occlusion,
 * emission, and the tile rank the pixel asks of the virtual textures.
 *
 * Two fragment stages consume it, and it is the only place the material is read: the blend
 * stage, which lights it in place (`shader.ts`), and the water surface stage, which
 * stores it for the fullscreen composite (`../water/surfaceWgsl.ts`). The host shader
 * declares `VSOut`, the atlas samplers and `blendRequest` before this block; the alpha test
 * discards here, so no stage shades a fragment the material rejects — nor one of a doubtful
 * triangle its side does not draw (`facing.ts`).
 */
export const BLEND_SURFACE_WGSL = `
${COTANGENT_FRAME_WGSL}
${BLEND_SURFACE_NORMAL_WGSL}
struct BlendSurface{rgb:vec3f,alpha:f32,N:vec3f,rough:f32,metal:f32,ao:f32,emissive:vec3f,request:u32,subsurface:vec3f,}
fn blendSurface(in:VSOut,front:bool)->BlendSurface{
 let flags=in.ids.y;
 let sampled=(flags&${FLAG_SAMPLED}u)!=0u;
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);
 let request=blendRequest(in,gradX,gradY);
 let q0=dpdx(in.view);let q1=dpdy(in.view);
 var N=blendGeometricNormal(in,front,q0,q1);
 let face=select(-1.0,1.0,front);
 let sample=colorSample(in.ids.x,in.uv,gradX,gradY,sampled);
 let alpha=sample.w*in.color.w;
 let rgb=in.color.xyz*sample.xyz;
 var rough=in.pbr.x;var metal=in.pbr.y;var ao=1.0;
 if(in.maps.x!=0u){rough*=dataSample(in.maps.x,in.uv,gradX,gradY,sampled).g;}
 if(in.maps.y!=0u){metal*=dataSample(in.maps.y,in.uv,gradX,gradY,sampled).b;}
 if(in.maps.w!=0u){ao+=in.alphaAo.y*(dataSample(in.maps.w,in.uv,gradX,gradY,sampled).r-1.0);}
 if(in.maps.z!=0u){
  let mapN=dataSample(in.maps.z,in.uv,gradX,gradY,sampled).xyz*2.0-vec3f(1.0);
  // The frame of the opaque resolve, on screen derivatives: framebuffer y runs down, hence the
  // sign, as on the geometric normal above.
  let frame=cotangentFrame(N,q0,q1,gradX,gradY);
  var T=-frame.T;var B=-frame.B;
  if((flags&2048u)!=0u){T=uniteOuZero(in.tangent.xyz);B=uniteOuZero(in.bitangent.xyz);}
  if((flags&2u)!=0u&&(flags&16u)!=0u){T*=face;B*=face;}
  N=uniteOuZero(T*mapN.x*in.pbr.z+B*mapN.y*in.pbr.w+N*mapN.z);
 }
 var emissive=in.emissive.xyz;
 if(in.ids.z!=0u){emissive*=colorSample(in.ids.z,in.uv,gradX,gradY,sampled).rgb;}
 if(alpha<in.alphaAo.x||facingDiscarded(in.water>>${FACING_SHIFT}u,front)){discard;}
 var thin=clamp(vec3f(in.normal.w,in.tangent.w,in.bitangent.w),vec3f(0.0),vec3f(1.0));
 if(in.emissive.w!=0.0){thin*=colorSample(u32(in.emissive.w),in.uv,gradX,gradY,sampled).rgb;}
 return BlendSurface(rgb,alpha,N,rough,metal,ao,emissive,request,thin);
}
${BLEND_SHADOW_FOOTPRINT_WGSL}`;
