import { BLEND_BINDINGS } from './webgpuBindLayout.ts';

/**
 * What class 3 — transmission — adds to the blend shader, and nothing else: three bindings and two
 * functions. A fragment that does not carry the transmission flag never calls them, so the image of
 * the other two classes does not move by a pixel.
 *
 * Everything is read on the imported material — `KHR_materials_transmission`, `KHR_materials_ior`,
 * `KHR_materials_volume` — and on the scene's declared sources: the contract lights and the probe
 * grid, the same ones the rest of the blend reads. No light of this pass's own (P6), no named scene,
 * no constant tuned to a scene.
 */
export const TRANSMISSION_WGSL = `
struct Volume{transmission:f32,ior:f32,thickness:f32,attenuationDistance:f32,attenuationColor:vec4f,}
@group(0) @binding(${BLEND_BINDINGS.volume}) var<uniform> volume:Volume;
@group(0) @binding(${BLEND_BINDINGS.backdrop}) var backdrop:texture_2d<f32>;
@group(0) @binding(${BLEND_BINDINGS.backdropDepth}) var backdropDepth:texture_depth_2d;
// Backdrop the surface lets through. The view ray is bent by the material IOR, advanced by its
// thickness, reprojected to the screen: that is where already-drawn colour is reread. A sample
// whose copied depth places it in front of the surface would show an object in front of the glass:
// we then fall back to the unbent sample. Depth is reversed, so "behind" is "smaller". The volume
// then attenuates by its colour.
fn transmittedBackdrop(P:vec3f,N:vec3f,V:vec3f,fragXY:vec2f,fragZ:f32)->vec3f{
 let size=vec2f(textureDimensions(backdrop));
 let last=size-vec2f(1.0);
 let straight=vec2i(clamp(fragXY,vec2f(0.0),last));
 let refracted=refract(-V,N,1.0/max(volume.ior,1e-3));
 var deviated=straight;
 if(dot(refracted,refracted)>1e-8&&volume.thickness>0.0){
  let clipPos=uni.viewProj*vec4f(P+normalize(refracted)*volume.thickness,1.0);
  if(clipPos.w>0.0){
   let ndc=clipPos.xy/clipPos.w;
   deviated=vec2i(clamp(vec2f((ndc.x*0.5+0.5)*size.x,(0.5-ndc.y*0.5)*size.y),vec2f(0.0),last));
  }
 }
 let chosen=select(straight,deviated,textureLoad(backdropDepth,deviated,0)<=fragZ);
 var attenuation=vec3f(1.0);
 if(volume.attenuationDistance>0.0){
  let sigma=-log(clamp(volume.attenuationColor.rgb,vec3f(1e-5),vec3f(1.0)))/volume.attenuationDistance;
  attenuation=exp(-sigma*volume.thickness);
 }
 return textureLoad(backdrop,chosen,0).rgb*attenuation;
}
// Composition of a transmissive surface. The transmitted share replaces alpha blending — that is
// the glTF model: a = alpha + t(1-alpha), and a·C carries the whole transmitted share. At zero
// transmission, rendered colour and opacity are those of class 2, to the bit.
//
// What the transmitted share returns: the refracted backdrop weighted by 1-F, environment
// reflection weighted by F — probe irradiance in the mirror direction, exactly zero when the scene
// carries none — and the specular of declared lights, obtained by evaluating the engine's only
// lighting formula on a null albedo: the diffuse lobe cancels, the dielectric specular lobe stays.
// An unlit view keeps neither.
fn transmissionColor(lit:vec3f,baseTint:vec3f,alpha:f32,N:vec3f,V:vec3f,P:vec3f,fragXY:vec2f,fragZ:f32,rough:f32,ao:f32,unlit:bool)->vec4f{
 // Normal of the side we look from. A single-sided surface, or a mesh with no normal attribute whose
 // normal comes from screen derivatives, can arrive here turned the wrong way: refraction would then
 // go through the wrong way and Fresnel would yield a black mirror. We always enter the volume by
 // the face we see, and it is that normal that describes the entry.
 let Nv=select(-N,N,dot(N,V)>0.0);
 let t=clamp(volume.transmission,0.0,1.0);
 let f0=pow((volume.ior-1.0)/(volume.ior+1.0),2.0);
 let F=f0+(1.0-f0)*pow(clamp(1.0-max(dot(Nv,V),0.0),0.0,1.0),5.0);
 let transmitted=baseTint*transmittedBackdrop(P,Nv,V,fragXY,fragZ);
 var reflected=vec3f(0.0);
 if(!unlit){
  reflected=F*sampleBounce(P,reflect(-V,Nv))*INVERSE_PI
   +declaredLighting(vec3f(0.0),0.0,rough,Nv,V,P,ao,fragXY);
 }
 let a=alpha+t*(1.0-alpha);
 return vec4f((t*((1.0-F)*transmitted+reflected)+(1.0-t)*alpha*lit)/max(a,1e-4),a);
}
`;
