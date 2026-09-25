import {
  CONTRACT_BINDINGS_WGSL,
  FULLSCREEN_VERTEX,
  SURFACE_BINDINGS_WGSL,
  VIEW_WGSL,
  WORLD_AT_WGSL,
} from '../../lighting/deferred/shaders.ts';
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts';
import {
  CONTRACT_SHADOW_BINDINGS,
  declaredLightingWgsl,
} from '../../lighting/direct/lightingWgsl.ts';
import { bounceApplyWgsl } from '../../bounce/applyWgsl.ts';
import { SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { BLEND_VIEW_WGSL } from '../blend/shader.ts';
import { WATER_UNPACK_WGSL } from './surfaceWgsl.ts';

/** Bindings of the composite: the deferred bounce layout as-is — surfaces and depth, the view,
 *  the contract, the probe grid, the proxy — then what only water reads: the frozen backdrop, the
 *  opaque depth, the blend view uniform and the material volumes. */
export const WATER_BINDINGS = {
  baseMetal: 0,
  normalRough: 1,
  emissiveAo: 2,
  flags: 3,
  depth: 4,
  view: 5,
  directLights: 6,
  tileLights: 7,
  shadowData: 8,
  shadowAtlas: 9,
  shadowSampler: 10,
  bounceGrid: 11,
  probes: 12,
  proxy: SUN_FAR_PROXY_BINDING,
  backdrop: 14,
  backdropDepth: 15,
  /** The blend view uniform, as written for the blend pass: projection, eye, tiles, flags. */
  uniform: 16,
  volumes: 17,
  /** The shadow pool's transmittance layer, on the deferred resolve's number. */
  shadowTransmittance: CONTRACT_SHADOW_BINDINGS.transmittance,
};

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
 * by its own depth, not by the basin's, as the single-layer water of the reference does. The
 * exit is one screen-space sample, checked against the surface depth, never a march: a ray that
 * crosses an object before its exit does not see it, a known limit shared with the forward pass.
 * And the share transmitted through an empty backdrop keeps that emptiness as coverage, so the
 * display background shows through a surface in front of nothing instead of a black radiance.
 */
export const WATER_COMPOSITE_SHADER = `${VIEW_WGSL}
${BLEND_VIEW_WGSL}
struct Volume{transmission:f32,ior:f32,thickness:f32,attenuationDistance:f32,attenuationColor:vec4f,}
${SURFACE_BINDINGS_WGSL}
${CONTRACT_BINDINGS_WGSL}
@group(0) @binding(${WATER_BINDINGS.backdrop}) var backdrop:texture_2d<f32>;
@group(0) @binding(${WATER_BINDINGS.backdropDepth}) var backdropDepth:texture_depth_2d;
@group(0) @binding(${WATER_BINDINGS.uniform}) var<uniform> uni:BlendView;
@group(0) @binding(${WATER_BINDINGS.volumes}) var<storage,read> volumes:array<Volume>;
${STANDARD_LIGHTING_WGSL}
${declaredLightingWgsl(WATER_BINDINGS.proxy, WATER_BINDINGS.shadowData, WATER_BINDINGS.shadowTransmittance)}
${bounceApplyWgsl(WATER_BINDINGS.bounceGrid, WATER_BINDINGS.probes)}
${WATER_UNPACK_WGSL}
${FULLSCREEN_VERTEX}
${WORLD_AT_WGSL}
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
 let size=vec2f(textureDimensions(backdrop));
 // The volume ends where the opaque scene begins: the ray travels the declared thickness, or the
 // distance to the backdrop under this pixel when that is shorter. A block just below the surface
 // is displaced and tinted by its own depth, not by the basin's.
 let path=min(vol.thickness,backdropDistance(P,straight,vol.thickness));
 let refracted=refract(-V,N,1.0/max(vol.ior,1e-3));
 var chosen=straight;
 if(dot(refracted,refracted)>1e-8&&path>0.0){
  let exit=exitPixel(P,normalize(refracted),path,straight,size);
  // A sample whose depth places it in front of the surface would show an object in front of the
  // water: the straight sample is read instead. Depth is reversed, so "behind" is "smaller".
  chosen=select(straight,exit,textureLoad(backdropDepth,exit,0)<=fragZ);
 }
 var attenuation=vec3f(1.0);
 if(vol.attenuationDistance>0.0){
  let sigma=-log(clamp(vol.attenuationColor.rgb,vec3f(1e-5),vec3f(1.0)))/vol.attenuationDistance;
  attenuation=exp(-sigma*path);
 }
 let sample=textureLoad(backdrop,chosen,0);
 return Transmitted(sample.rgb*attenuation,sample.a);
}
@fragment fn composeWater(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let packed=textureLoad(flags,coord,0).r;
 if(packed==0u){discard;}
 let vol=volumes[waterRank(packed)];
 let alpha=waterOpacity(packed);
 let base=textureLoad(baseMetal,coord,0);
 let normal=textureLoad(normalRough,coord,0);
 let emissiveAo=textureLoad(emissiveAo,coord,0);
 let fragZ=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,fragZ);
 shadowFootprint=length(worldAt(pixel.xy+vec2f(1.0,0.0),fragZ)-P);
 let V=normalize(view.camera.xyz-P*view.camera.w);
 // Normal of the side we look from: a single-sided surface, or a mesh with no normal attribute
 // whose normal comes from screen derivatives, can arrive turned the wrong way, and refraction
 // would then go through the wrong way while Fresnel would yield a black mirror.
 let Nv=select(-normal.xyz,normal.xyz,dot(normal.xyz,V)>0.0);
 let rough=clamp(normal.a,0.0525,1.0);
 let metal=clamp(base.a,0.0,1.0);
 let ao=emissiveAo.a;
 // A transmissive material is a physical one, hence lit; only the unlit view keeps raw albedo.
 let unlit=(uni.viewFlags&${FLAG_UNLIT_VIEW}u)!=0u;
 var lit=base.rgb;
 var reflected=vec3f(0.0);
 let t=clamp(vol.transmission,0.0,1.0);
 let f0=pow((vol.ior-1.0)/(vol.ior+1.0),2.0);
 let F=f0+(1.0-f0)*pow(clamp(1.0-max(dot(Nv,V),0.0),0.0,1.0),5.0);
 if(!unlit){
  lit=declaredLighting(base.rgb,metal,rough,Nv,V,P,ao,pixel.xy)+bounceLighting(base.rgb,metal,Nv,P,ao)+environmentLighting(base.rgb,metal,Nv,ao)+emissiveAo.rgb;
  // Environment reflection weighted by Fresnel — probe irradiance in the mirror direction, exactly
  // zero when the scene carries none — and the specular of the declared lights on a null albedo:
  // the diffuse lobe cancels, the dielectric specular lobe stays.
  reflected=F*sampleBounce(P,reflect(-V,Nv))*INVERSE_PI+declaredLighting(vec3f(0.0),0.0,rough,Nv,V,P,ao,pixel.xy);
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
 return vec4f(select(fogged(color,P,uni.eye.xyz),color,unlit),a);
}
`;
