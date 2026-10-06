import {
  BOUNDED_SCREEN_REFLECTION_WGSL,
  SCREEN_REFLECTION_WGSL,
} from '../../reflections/screenWgsl.ts'
import {
  CONTRACT_BINDINGS_WGSL,
  FULLSCREEN_VERTEX,
  surfaceBindingsWgsl,
  VIEW_WGSL,
  WORLD_AT_WGSL,
} from '../../lighting/deferred/shaders.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import {
  CONTRACT_SHADOW_BINDINGS,
  declaredLightingWgsl,
} from '../../lighting/direct/lightingWgsl.ts'
import { shadowKindsOf } from '../../lighting/direct/shadowKinds.ts'
import { bounceApplyWgsl } from '../../bounce/applyWgsl.ts'
import { BOUNCE_SURFACE_BINDING, bounceReflectionWgsl } from '../../bounce/reflectWgsl.ts'
import { RESIDENT_PROXY_BINDING } from '../../bounce/nodeWgsl.ts'
import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts'
import { BLEND_VIEW_WGSL } from '../blend/shader.ts'
import { WATER_UNPACK_WGSL } from './surfaceWgsl.ts'
import { WATER_SHADOW_READ_WGSL } from './shadowReadWgsl.ts'
import { VOLUME_LAW_WGSL } from '../transparent/volumeLaw.ts'
import type { ContractKey } from '../../lighting/deferred/contractVariants.ts'

/** Bindings of the composite: the deferred bounce layout as-is — surfaces and depth, the view,
 *  the contract, the probe grid, the proxy — then what only water reads: the frozen backdrop, the
 *  opaque depth, the blend view uniform and the material volumes. */
export const WATER_BINDINGS = {
  baseMetal: 0,
  normalRough: 1,
  emissiveAo: 2,
  /** The water word the surface stage wrote (`surfaceWgsl.ts`), on the surface flags' number. */
  word: 3,
  depth: 4,
  view: 5,
  directLights: 6,
  tileLights: 7,
  shadowData: 8,
  shadowAtlas: 9,
  shadowSampler: 10,
  bounceGrid: 11,
  probes: 12,
  proxy: RESIDENT_PROXY_BINDING,
  backdrop: 14,
  backdropDepth: 15,
  /** The blend view uniform, as written for the blend pass: projection, eye, tiles, flags. */
  uniform: 16,
  volumes: 17,
  /** The shadow pool's transmittance layer, on the deferred resolve's numbers. */
  shadowTransmittance: CONTRACT_SHADOW_BINDINGS.transmittance,
  shadowTranslucentDepth: CONTRACT_SHADOW_BINDINGS.translucentDepth,
  surface: BOUNCE_SURFACE_BINDING,
}

/**
 * Fullscreen composite of the water pass. A pixel the surface stage wrote is lit once here: the
 * transmitted backdrop, refracted by the material IOR and attenuated over the distance the ray
 * travels in the volume; the reflection of the probe grid weighted by Fresnel; the specular of the
 * declared lights; and the surface's own lit colour for what the material does not transmit.
 * Everything is read on the imported material — `KHR_materials_transmission`, `KHR_materials_ior`,
 * `KHR_materials_volume` — and the scene's declared sources, with the engine's only lighting
 * formula. No light of the pass's own, no constant tuned to a scene (P6).
 *
 * What differs from the glTF sample viewer's forward composition: **the volume ends where the
 * opaque scene begins.** The refracted ray travels the declared thickness, or the distance to the
 * frozen backdrop under the pixel when that is shorter, and both the exit it is reread at and the
 * attenuation follow that distance — a block just below a basin's surface is displaced and tinted
 * by its own depth, not by the basin's, unlike a single-layer water. The
 * exit is one screen-space sample, checked against the surface depth, never a march: a ray that
 * crosses an object before its exit does not see it, a known limit shared with the forward pass.
 * And the share transmitted through an empty backdrop keeps that emptiness as coverage, so the
 * display background shows through a surface in front of nothing instead of a black radiance.
 * Its mirror ray is bounded (`BOUNDED_SCREEN_REFLECTION_WGSL`), but in a reference session:
 * `unbounded`, the whole walk and the proxy ray (`reflectionTrace`, `frame/referenceMode.ts`).
 * The surface's lit colour, which only the share the material does not transmit, `(1-t)·alpha`,
 * carries into the composite: at full transmission (`t` = 1) that share is zero, `0·alpha·lit` an
 * exact zero whatever finite colour `lit` holds, and the bounce walk, the environment and the
 * emission are not evaluated — the colour and coverage are the same numbers, a zero's sign aside
 * (`litShare.test.ts`). The declared lights stay one walk for both sums (`declaredLightingPair`):
 * their specular is the reflection's.
 * Its light loop is without the shadow or the rectangle code `key` leaves out
 * (`declaredLightingWgsl`), the program of a scene that holds none (`pipelines.ts`).
 */
export const waterCompositeShader = (
  unbounded = false,
  key: Partial<ContractKey> = {},
) => `${VIEW_WGSL}
${BLEND_VIEW_WGSL}
struct Volume{transmission:f32,eta:f32,thickness:f32,f0:f32,attenuation:vec4f,}
${surfaceBindingsWgsl('waterWord:texture_2d<f32>')}
${CONTRACT_BINDINGS_WGSL}
@group(0) @binding(${WATER_BINDINGS.backdrop}) var backdrop:texture_2d<f32>;
@group(0) @binding(${WATER_BINDINGS.backdropDepth}) var backdropDepth:texture_depth_2d;
@group(0) @binding(${WATER_BINDINGS.uniform}) var<uniform> uni:BlendView;
@group(0) @binding(${WATER_BINDINGS.volumes}) var<storage,read> volumes:array<Volume>;
${STANDARD_LIGHTING_WGSL}
${declaredLightingWgsl(WATER_BINDINGS.proxy, WATER_BINDINGS.shadowTransmittance, undefined, true, !key.unshadowed, !key.rectless, shadowKindsOf(key))}
${bounceApplyWgsl(WATER_BINDINGS.bounceGrid, WATER_BINDINGS.probes)}
${bounceReflectionWgsl(WATER_BINDINGS.surface)}
${WATER_UNPACK_WGSL}
${VOLUME_LAW_WGSL}
${FULLSCREEN_VERTEX}
${WORLD_AT_WGSL}
${WATER_SHADOW_READ_WGSL}
// Pixel where the ray from P along dir, advanced by dist, lands; the straight pixel when it
// leaves the frustum.
fn exitPixel(P:vec3f,dir:vec3f,dist:f32,straight:vec2i,size:vec2f)->vec2i{
 let clipPos=uni.viewProj*vec4f(P+dir*dist,1.0);
 if(clipPos.w<=0.0){return straight;}
 let ndc=clipPos.xy/clipPos.w;
 return vec2i(clamp(vec2f((ndc.x*0.5+0.5)*size.x,(0.5-ndc.y*0.5)*size.y),vec2f(0.0),size-vec2f(1.0)));
}
// Distance from P to the backdrop at a pixel, or the declared thickness when nothing was drawn.
fn backdropDistance(P:vec3f,pixel:vec2i,thickness:f32)->f32{
 let z=textureLoad(backdropDepth,pixel,0);
 return select(thickness,distance(P,worldAt(vec2f(pixel)+vec2f(0.5),z)),z>0.0);
}
struct Transmitted{color:vec3f,coverage:f32,}
fn transmittedBackdrop(vol:Volume,P:vec3f,N:vec3f,V:vec3f,straight:vec2i,fragZ:f32)->Transmitted{
 let size=view.viewport.xy;
 // The volume ends where the opaque scene begins: the ray travels the declared thickness, or the
 // distance to the backdrop under this pixel when that is shorter. A block just below the surface
 // is displaced and tinted by its own depth, not by the basin's.
 let path=min(vol.thickness,backdropDistance(P,straight,vol.thickness));
 let refracted=refract(-V,N,vol.eta);
 var chosen=straight;
 if(dot(refracted,refracted)>1e-8&&path>0.0){
  let exit=exitPixel(P,normalize(refracted),path,straight,size);
  // A sample whose depth places it in front of the surface would show an object in front of the
  // water: the straight sample is read instead. Depth is reversed, so "behind" is "smaller".
  chosen=select(straight,exit,textureLoad(backdropDepth,exit,0)<=fragZ);
 }
 let sample=textureLoad(backdrop,chosen,0);
 return Transmitted(sample.rgb*volumeTransmittance(vol.attenuation.rgb,path),sample.a);
}
fn waterColor(pixel:vec4f)->vec4f{
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
 // Shadows read at the pixel's own footprint (\`shadowReadWgsl.ts\`); the normal of the side
 // we look from, else refraction would go the wrong way and Fresnel yield a black mirror.
 shadowFootprint=waterShadowFootprint(pixel.xy,fragZ,P);
 shadowSetView(view.camera.xyz,view.viewport.x,pixel.xy,u32(view.jitter.w),shadowFootprint,worldAt(view.viewport.xy*0.5,fragZ));
 let V=waterViewDirection(P);
 let Nv=waterFacing(normal.xyz,V);
 let rough=clamp(normal.a,${ROUGHNESS_FLOOR},1.0);
 let metal=clamp(base.a,0.0,1.0);
 let ao=emissiveAo.a;
 // A transmissive material is a physical one, hence lit; only the unlit view keeps raw albedo.
 let unlit=(uni.viewFlags&${FLAG_UNLIT_VIEW}u)!=0u;
 var lit=base.rgb;
 var reflected=vec3f(0.0);
 let t=clamp(vol.transmission,0.0,1.0);
 // Fresnel by the fifth-power approximation, as two squares and a product.
 let grazing=clamp(1.0-max(dot(Nv,V),0.0),0.0,1.0);let grazing2=grazing*grazing;
 let F=vol.f0+(1.0-vol.f0)*(grazing2*grazing2*grazing);
 if(!unlit){
  // One walk of the declared lights, two sums: the surface's, and the null albedo's below.
  let declared=declaredLightingPair(base.rgb,metal,rough,Nv,V,P,ao,pixel.xy,fragZ);
  if(t<1.0){lit=declared.lit+bounceLighting(base.rgb,metal,Nv,P,ao)+environmentLighting(base.rgb,metal,Nv,ao)+emissiveAo.rgb;}
  // What the mirror direction sees, weighted by Fresnel — the engine's one reflection model: the
  // proxy traced at the roughness floor, the probe irradiance over π above it, exactly zero without
  // bounce — and the specular of the declared lights on a null albedo: the diffuse lobe cancels,
  // the dielectric specular lobe stays.
  reflected=F*resolvedRadiance(P,Nv,reflect(-V,Nv),rough)+declared.specular;
 }
 let through=transmittedBackdrop(vol,P,Nv,V,coord,fragZ);
 // The glTF composition, a = alpha + t(1-alpha) with a·C carrying the whole transmitted share,
 // written by coverage: the blended share covers by its opacity, the reflected share by Fresnel,
 // and the transmitted share only as much as the backdrop it read — over an empty backdrop it
 // leaves that emptiness to the display background. On a drawn backdrop the sum is the glTF one.
 let a=(1.0-t)*alpha+t*(F+(1.0-F)*through.coverage);
 let premultiplied=t*((1.0-F)*base.rgb*through.color+reflected)+(1.0-t)*alpha*lit;
 // Seen through the fog between the eye and the surface, as every surface is.
 let color=premultiplied/max(a,1e-4);
 return vec4f(select(fogged(color,P,uni.eye.xyz),color,unlit||vol.attenuation.w!=0.0),a);
}
@fragment fn composeWater(@builtin(position) pixel:vec4f)->@location(0) vec4f{return waterColor(pixel);}
struct Composed{@location(0) color:vec4f,@location(1) reactive:vec4f,}
@fragment fn composeWaterReactive(@builtin(position) pixel:vec4f)->Composed{
 let c=waterColor(pixel);
 return Composed(c,vec4f(0.0,1.0,0.0,c.a));
}

${unbounded ? SCREEN_REFLECTION_WGSL : BOUNDED_SCREEN_REFLECTION_WGSL}
`
