import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstantsWgsl.ts'
import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts'
import { VOLUME_FOG_FREE } from '../transparent/transmission.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fresnelScalar } from '../../../../math/src/wgsl/lighting.ts'

/** A water pixel's colour and coverage (`compositeWgsl.ts`): the transmitted backdrop, the
 *  reflection weighted by Fresnel and the surface's lit share, composed as glTF composes them. It
 *  reads only constants: one text for every program of the composite. */
export const WATER_COLOR_WGSL = wgslBlock(
  'WATER_COLOR_WGSL',
  [fresnelScalar, ROUGHNESS_FLOOR],
  `fn waterColor(pixel:vec4f)->vec4f{
 let coord=vec2i(pixel.xy);
 let packed=waterWordAt(coord);
 if(packed==0u){discard;}
 let vol=volumes[waterRank(packed)];
 let alpha=waterOpacity(packed);
 let base=textureLoad(baseMetal,coord,0);
 let normal=textureLoad(normalRough,coord,0);
 let emissiveAo=textureLoad(emissiveAo,coord,0);
 let fragZ=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,fragZ);
 // Shadows read at the pixel's own footprint (\`shadowReadWgsl.ts\`, #1412); the normal of the side
 // we look from, else refraction would go the wrong way and Fresnel yield a black mirror.
 shadowFootprint=waterShadowFootprint(pixel.xy,fragZ,P);
 shadowSetView(view.camera.xyz,view.viewport.x,pixel.xy,u32(view.jitter.w),shadowFootprint,worldAt(view.viewport.xy*0.5,fragZ));
 let V=waterViewDirection(P);
 let Nv=waterFacing(normal.xyz,V);
 let rough=clamp(normal.a,ROUGHNESS_FLOOR,1.0);
 let metal=clamp(base.a,0.0,1.0);
 let ao=emissiveAo.a;
 // A transmissive material is a physical one, hence lit; only the unlit view keeps raw albedo.
 let unlit=(uni.viewFlags&${FLAG_UNLIT_VIEW}u)!=0u;
 var lit=base.rgb;
 var reflected=vec3f(0.0);
 let t=clamp(vol.transmission,0.0,1.0);
 // Fresnel by the engine's fifth-power approximation, on the volume's reflectance.
 let F=fresnelScalar(vol.f0,max(dot(Nv,V),0.0));
 if(!unlit){
  waterLobes(vol,coord,Nv,V,rough,select(-1.0,1.0,dot(normal.xyz,V)>0.0));
  // One walk of the declared lights, two sums: the surface's, and the null albedo's below.
  let declared=declaredLightingPair(base.rgb,metal,rough,Nv,V,P,ao,pixel.xy,fragZ);
  if(t<1.0){lit=declared.lit+bounceLighting(base.rgb,metal,Nv,P,ao)*lobeThrough()+environmentLighting(base.rgb,metal,Nv,ao)*lobeThrough()+emissiveAo.rgb;}
  // What the mirror direction sees, weighted by Fresnel — the engine's one reflection model: the
  // proxy traced at the roughness floor, the probe irradiance over π above it, exactly zero without
  // bounce — and the specular of the declared lights on a null albedo: the diffuse lobe cancels,
  // the dielectric specular lobe stays.
  reflected=waterCoatMirror(F*resolvedRadiance(P,Nv,reflect(-V,Nv),rough)*lobeThrough(),V,P)+declared.specular;
 }
 let through=transmittedBackdrop(vol,P,Nv,V,coord,fragZ);
 // The glTF composition, a = alpha + t(1-alpha) with a·C carrying the whole transmitted share,
 // written by coverage: the blended share covers by its opacity, the reflected share by Fresnel,
 // and the transmitted share only as much as the backdrop it read — over an empty backdrop it
 // leaves that emptiness to the display background. On a drawn backdrop the sum is the glTF one.
 let a=(1.0-t)*alpha+t*(F+(1.0-F)*through.coverage);
 let premultiplied=t*((1.0-F)*base.rgb*through.color*lobeThrough()+reflected)+(1.0-t)*alpha*lit;
 // Seen through the fog between the eye and the surface, as every surface is.
 let color=premultiplied/max(a,1e-4);
 return vec4f(select(fogged(color,P,uni.eye.xyz),color,unlit||volumeMarked(vol,${VOLUME_FOG_FREE}u)),a);
}`,
)
