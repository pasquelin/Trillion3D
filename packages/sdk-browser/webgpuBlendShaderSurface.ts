import { COTANGENT_FRAME_WGSL } from './clusterDecodeWgsl.ts';
import { WRAP_MAP } from './visibilityWrapModes.ts';

/**
 * What a transparent fragment reads on its material, before any lighting: base colour and
 * opacity, the normal — from the vertex attribute, from screen derivatives, then bent by the
 * normal map in the cotangent frame the opaque resolve uses —, roughness, metalness, occlusion,
 * emission, and the tile rank the pixel asks of the virtual textures.
 *
 * Two fragment stages consume it, and it is the only place the material is read: the blend
 * stage, which lights it in place (`webgpuBlendShader.ts`), and the water surface stage, which
 * stores it for the fullscreen composite (`webgpuWaterSurfaceWgsl.ts`). The host shader
 * declares `VSOut`, the atlas samplers and `blendRequest` before this block; the alpha test
 * discards here, so no stage shades a fragment the material rejects.
 */
export const BLEND_SURFACE_WGSL = `
${COTANGENT_FRAME_WGSL}
struct BlendSurface{rgb:vec3f,alpha:f32,N:vec3f,rough:f32,metal:f32,ao:f32,emissive:vec3f,request:u32,}
fn blendSurface(in:VSOut,front:bool)->BlendSurface{
 let flags=in.ids.y;
 let wrap=in.ids.w;
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);
 let request=blendRequest(in,wrap,gradX,gradY);
 let q0=dpdx(in.view);let q1=dpdy(in.view);
 // uniteOuZero yields normalize wherever the vector is not null: same bits as before on an
 // ordinary surface, a null vector — and not NaN — on a collapsed face, whose a NaN would win
 // neighbouring pixels through screen derivatives. A rank-2 pose does not arrive there null:
 // xformNormal already gave it the flattened face's normal.
 // The geometric normal comes from screen derivatives: it already looks at the observer, whatever
 // the rasterised face. Only a vertex normal, which points toward the declared outside, flips on
 // the back of a two-sided material — flipping it too would send the geometric one opposite the
 // light, and the surface would render exactly zero. Same rule as the opaque resolve, which only
 // flips the interpolated normal.
 var N=uniteOuZero(-cross(q0,q1));
 let face=select(-1.0,1.0,front);
 if((flags&16u)!=0u){
  N=uniteOuZero(in.normal);
  if((flags&2u)!=0u){N*=face;}
 }
 let sample=colorSample(in.ids.x,in.uv,wrapOf(wrap,${WRAP_MAP.base}u),gradX,gradY);
 let alpha=sample.w*in.color.w;
 let rgb=in.color.xyz*sample.xyz;
 var rough=in.pbr.x;var metal=in.pbr.y;var ao=1.0;
 if(in.maps.x!=0u){rough*=dataSample(in.maps.x,in.uv,wrapOf(wrap,${WRAP_MAP.rough}u),gradX,gradY).g;}
 if(in.maps.y!=0u){metal*=dataSample(in.maps.y,in.uv,wrapOf(wrap,${WRAP_MAP.metal}u),gradX,gradY).b;}
 if(in.maps.w!=0u){ao+=in.alphaAo.y*(dataSample(in.maps.w,in.uv,wrapOf(wrap,${WRAP_MAP.ao}u),gradX,gradY).r-1.0);}
 if(in.maps.z!=0u){
  let mapN=dataSample(in.maps.z,in.uv,wrapOf(wrap,${WRAP_MAP.normal}u),gradX,gradY).xyz*2.0-vec3f(1.0);
  // The frame of the opaque resolve, on screen derivatives: framebuffer y runs down, hence the
  // sign, as on the geometric normal above.
  let frame=cotangentFrame(N,q0,q1,gradX,gradY);
  var T=-frame.T;var B=-frame.B;
  if((flags&2048u)!=0u){T=uniteOuZero(in.tangent);B=uniteOuZero(in.bitangent);}
  if((flags&2u)!=0u&&(flags&16u)!=0u){T*=face;B*=face;}
  N=uniteOuZero(T*mapN.x*in.pbr.z+B*mapN.y*in.pbr.w+N*mapN.z);
 }
 var emissive=in.emissive.xyz;
 if(in.ids.z!=0u){emissive*=colorSample(in.ids.z,in.uv,wrapOf(wrap,${WRAP_MAP.emissive}u),gradX,gradY).rgb;}
 if(alpha<in.alphaAo.x){discard;}
 return BlendSurface(rgb,alpha,N,rough,metal,ao,emissive,request);
}
`;
