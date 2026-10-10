import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { DIELECTRIC_F0, ndotvClamped } from '../../../math/src/wgsl/lighting.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { LTC_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'

/**
 * What a lit surface keeps of the radiance it reflects, and how it traces it. `reflectionWeight`
 * is the engine's split-sum term of its GGX lobe at its roughness and N·V (the fitted magnitude and
 * Fresnel share the rectangle lights read, `ltcSplitSum`, in every lighting program), on its
 * reflectance `f0`: `f0Of` of its colour and metalness, a dielectric's on a coat, the water's own.
 * `reflectionTrace` is what its lobes reflect, the radiance of each traced once (`Reflected`): the
 * base lobe's, along the lobe the lights read (`reflectionLobe`: the long axis `setLobes` left —
 * its direction and αt where the material is anisotropic, a round lobe elsewhere), and, where the
 * surface carries a clear coat, the coat's own dielectric lobe on its normal and roughness — a
 * second `reflectedRadiance`, only where the coat is above zero. `reflectionShare` is the traced
 * radiance weighed on a reflectance, the base let through the coat as every other term is
 * (`lobeThrough`), and the coat's added; `reflectedShare` traces and weighs on one reflectance. A
 * program without lobes has no coat and a round lobe.
 */
export const reflectionShareWgsl = (group: number, lobes: boolean) =>
  wgslBlock(
    `reflectionShareWgsl(${group}, ${lobes})`,
    [reflectedRadianceWgsl(group), LTC_WGSL, LOBE_AXIS_WGSL, ndotvClamped, DIELECTRIC_F0],
    `struct Reflected{base:vec3f,coat:vec3f,}
fn reflectionWeight(f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return ltcSplitSum(f0,lobeRoughness(rough),ndotvClamped(N,V));
}
${
  lobes
    ? `fn reflectionLobe(rough:f32)->vec4f{
 if(lobes.on){return vec4f(lobes.T,lobes.at);}
 return vec4f(0.0,0.0,0.0,lobeAlpha(rough));
}
fn reflectionTrace(P:vec3f,N:vec3f,V:vec3f,rough:f32)->Reflected{
 var traced=Reflected(reflectedRadiance(P,N,V,rough,reflectionLobe(rough)),vec3f(0.0));
 if(lobes.on&&lobes.coat>0.0){
  traced.coat=reflectedRadiance(P,lobes.coatN,V,lobes.coatRough,vec4f(0.0,0.0,0.0,lobeAlpha(lobes.coatRough)));
 }
 return traced;
}
fn reflectionShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 var share=traced.base*reflectionWeight(f0,rough,N,V)*lobeThrough();
 if(lobes.on&&lobes.coat>0.0){share+=lobes.coat*traced.coat*reflectionWeight(DIELECTRIC_F0,lobes.coatRough,lobes.coatN,V);}
 return share;
}`
    : `fn reflectionLobe(rough:f32)->vec4f{return vec4f(0.0,0.0,0.0,lobeAlpha(rough));}
fn reflectionTrace(P:vec3f,N:vec3f,V:vec3f,rough:f32)->Reflected{
 return Reflected(reflectedRadiance(P,N,V,rough,reflectionLobe(rough)),vec3f(0.0));
}
fn reflectionShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return traced.base*reflectionWeight(f0,rough,N,V);
}`
}
fn reflectedShare(f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 return reflectionShare(reflectionTrace(P,N,V,rough),f0,rough,N,V);
}`,
  )

/** A forward program's reflection (blend, water), inline in its fragment stage, its resources in
 *  bind group `group`: `surfaceReflection` the blend's, traced here and weighed on the reflectance
 *  `f0` as the opaque trace's is (`reflectedShare`); the water traces once (`reflectionTrace`)
 *  and weighs the one trace on two reflectances (`reflectionShare`). */
export const forwardReflectionWgsl = (group: number, lobes: boolean) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes})`,
    [reflectionShareWgsl(group, lobes), surfaceReflects],
    `fn surfaceReflection(f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return reflectedShare(f0,rough,N,V,P);
}`,
  )

/** The opaque resolve's binding of the reflection target the compute pass wrote (`trace.ts`). */
export const REFLECTION_TARGET_BINDING = 33
/** The reflection target, read by load alone by the opaque resolve. */
export const REFLECTION_TARGET = loadOnlyTarget(
  REFLECTION_TARGET_BINDING,
  'rgba16float',
  'reflectionTarget',
)

/** The opaque resolve's reflection: the share the compute pass traced for its pixel, weighed and
 *  coated there (`reflectedShare`), added as it is. */
export const resolvedReflectionWgsl = wgslBlock(
  'resolvedReflectionWgsl',
  [surfaceReflects],
  `${REFLECTION_TARGET.wgsl}
fn resolvedReflection(coord:vec2i)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return textureLoad(reflectionTarget,coord).rgb;
}`,
)
