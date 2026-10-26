import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { DISTORTION_FUDGE } from '../distortionFudge.ts'
import { WATER_COMMON_WGSL } from './waterCommonWgsl.ts'

/**
 * THE WATER'S VOLUME: the light a body of water gives toward the eye, seen from above through one
 * layer, integrated analytically along the view ray between the surface and what lies behind it.
 * Depths are metres in the world, centimetres in the law (`WATER_CM`): the coefficients are per
 * centimetre.
 *
 * `waterVolume` takes the surface's point and normal, its depth and the slope of it across the pixel,
 * its specular (the refraction's index follows from its reflectance, or the graph's own), the
 * volume's scattering and absorption coefficients, the phase function's anisotropy and the colour
 * scale of what lies behind, the sun (`WaterSun`: its illuminance, its direction toward it and its
 * shadow), the ambient illuminance, the surface's environment reflectance `fresnel` and the
 * `visibility` the base material leaves it (one minus its coverage), and `separate` whether the sun's in-scattering is kept apart
 * (`sunLuminance`) from the rest, and gives:
 *  - the refracted read of what lies behind, twice: at the pixel, and where the refraction moved it
 *    (the offset of the surface normal, as the distortion's, scaled up four times, faded by the
 *    thickness of the water below 30 cm and by the pixel's depth difference below 1 cm); the second
 *    stands where its bilateral weights are not all zero;
 *  - the water's depth, the optical depth of the extinction over it, the transmittance of it, and the
 *    transmittance toward the light sources of the point behind (the fall from the scene to the
 *    surface's height, straight up), which also dims what lies behind it;
 *  - the sun's in-scattering, its phase function taken in the refracted direction of the view
 *    (zero under a total internal reflection), and the ambient's isotropic one, over the share of
 *    the light the volume scatters before it is absorbed;
 *  - the Fresnel of the surface taken off the scattered light (and the sun's, apart) and from the
 *    transmittance: the light reflected is not let in.
 * `luminance` is the visibility times the in-scattering plus the transmittance times what lies
 * behind (un-exposed, then times the colour scale), `toScene` the transmittance, `toSceneToLight`
 * that and the one toward the light.
 */
export const WATER_VOLUME_WGSL = wgslBlock(
  'WATER_VOLUME_WGSL',
  [WATER_COMMON_WGSL, INVERSE_PI],
  `struct WaterSun{illuminance:vec3f,toward:vec3f,shadow:f32,color:vec3f,}
struct WaterVolume{luminance:vec3f,toScene:vec3f,toSceneToLight:vec3f,depth:f32,shore:f32,sunLuminance:vec3f,}
fn waterRefractionOffset(N:vec3f,ior:f32)->vec2f{
 let viewNormal=vec2f(dot(uni.viewRight.xyz,N),dot(uni.viewUp.xyz,N));
 return viewNormal*(ior-1.0)*vec2f(${DISTORTION_FUDGE},-${DISTORTION_FUDGE})*vec2f(uni.viewRight.w,uni.viewUp.w);
}
fn waterVolume(in:VSOut,surfaceDepth:f32,slope:f32,N:vec3f,V:vec3f,specular:f32,graphIor:f32,scatter:vec3f,absorb:vec3f,phaseG:f32,colorScale:vec3f,sun:WaterSun,ambient:vec3f,fresnel:vec3f,visibility:f32,separate:bool)->WaterVolume{
 var out=WaterVolume(vec3f(0.0),vec3f(1.0),vec3f(1.0),0.0,0.0,vec3f(0.0));
 if(visibility<=0.0){return out;}
 let size=uni.viewport;
 let ior=select(waterIor(0.08*specular),graphIor,graphIor>0.0);
 let uv0=clamp(in.position.xy/size,water.bounds.xy,water.bounds.zw);
 let pixel=waterBehind(uv0,surfaceDepth,slope);
 out.shore=saturate((pixel.depth-surfaceDepth)*WATER_CM*0.02)*select(0.0,1.0,pixel.depth>surfaceDepth);
 // The offset in buffer units, scaled up four times and faded by the pixel's own depth (a surface
 // within a centimetre of the scene is not bent) and by the water's thickness below 30 cm.
 var offset=waterRefractionOffset(N,ior);
 offset*=saturate((pixel.depth-surfaceDepth)*WATER_CM);
 offset*=4.0;
 offset*=saturate((pixel.depth-surfaceDepth)*WATER_CM/30.0);
 let uv1=clamp(uv0+offset,water.bounds.xy,water.bounds.zw);
 let moved=waterBehind(uv1,surfaceDepth,slope);
 let weightsMoved=moved.weights*moved.mask;
 let useMoved=any(moved.weights!=vec4f(0.0));
 let behindDepth=select(pixel.depth,moved.depth,useMoved);
 let behindUv=select(uv0,uv1,useMoved);
 let behindWeights=select(pixel.weights*pixel.mask,weightsMoved,useMoved);
 let volumeDepth=max(0.0,behindDepth-surfaceDepth)*WATER_CM;
 let extinction=scatter+absorb;
 let scaleBehind=mix(vec3f(1.0),colorScale,saturate(volumeDepth*0.02));
 let extinctionSafe=max(extinction,vec3f(1e-5));
 var phaseValue=0.0;
 let r=waterRefract(V,N,1.0/ior);
 if(r.w>0.5){phaseValue=waterPhase(phaseG,dot(sun.toward*-1.0,r.xyz));}
 let behind=waterWorldAt(in.position.xy,size,behindDepth);
 let fall=max(0.0,(in.view.y-behind.y)*WATER_CM);
 let toLight=exp(-fall*extinction);
 let behindLuminance=waterBehindColor(behindUv,behindWeights)*toLight/uni.preExposure;
 let sunScattered=phaseValue*sun.illuminance;
 let ambientScattered=ambient*(0.25*INVERSE_PI);
 let optical=extinction*volumeDepth;
 let transmittance=exp(-optical);
 let sunTerm=sunScattered*sun.shadow;
 let incoming=ambientScattered+select(sunTerm,vec3f(0.0),separate);
 let share=saturate(scatter*(vec3f(1.0)-transmittance)/extinctionSafe);
 let scattered=incoming*share*(vec3f(1.0)-fresnel);
 out.luminance=visibility*(scattered+transmittance*(behindLuminance*scaleBehind));
 out.toScene=transmittance;
 out.toSceneToLight=transmittance*toLight;
 // The sun's in-scattering kept apart (the separated sun), faded by the Fresnel and the visibility as the rest is.
 out.sunLuminance=select(vec3f(0.0),sunTerm*share*(vec3f(1.0)-fresnel)*visibility,separate);
 out.depth=volumeDepth;
 return out;
}
`,
)
