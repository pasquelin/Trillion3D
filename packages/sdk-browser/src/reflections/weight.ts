import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { f0Of, ndotvClamped, splitSumTerm } from '../../../math/src/wgsl/lighting.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstantsWgsl.ts'
import { MODEL_FLAG } from '../scene/surfaceModel.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { reflectionFieldWgsl } from './field.ts'
import { REFLECTION_VIEW_WGSL } from './viewLayout.ts'

/**
 * What a lit surface keeps of the radiance it reflects. `reflectionWeight` is the engine's
 * split-sum term of its GGX lobe at its roughness and N·V (the fitted magnitude and Fresnel share
 * the rectangle lights read, `ltcLookup`, in every lighting program), on its reflectance.
 * `reflectionCoat` is a clear coat's own dielectric lobe on its normal and roughness, the
 * environment's — its field the base's (`reflectionField`, read at `P`; with the cascades where
 * `probes`) —, zero without a coat; `reflectionShare` the reflected radiance `reflected` weighed,
 * let through the coat as every other term is (`lobeThrough`), and the coat's added. `reflects` is
 * whether the surface model has a specular lobe, and `reflectionLobe` the long axis of the lobe the
 * lights read (`setLobes`): its direction and αt where the material is anisotropic, a round lobe
 * of rough² elsewhere. A program without lobes has no coat and a round lobe.
 */
const reflectionWeightWgsl = (lobes: boolean, probes: boolean) =>
  wgslBlock(
    `reflectionWeightWgsl(${lobes}, ${probes})`,
    [reflectionFieldWgsl(probes), splitSumTerm, f0Of, ndotvClamped, ROUGHNESS_FLOOR],
    `fn reflectionWeight(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return splitSumTerm(f0Of(rgb,metal),ltcLookup(clamp(rough,ROUGHNESS_FLOOR,1.0),ndotvClamped(N,V),1u));
}
fn reflects()->bool{return surfaceModel==${MODEL_FLAG.physical}u;}
fn reflectionShare(reflected:vec3f,coat:vec3f,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return reflected*reflectionWeight(rgb,metal,rough,N,V)*lobeThrough()+coat;
}
${
  lobes
    ? `fn reflectionLobe(rough:f32)->vec4f{
 if(lobes.on&&lobes.strength>0.0){return vec4f(lobes.T,lobes.at);}
 let r=clamp(rough,ROUGHNESS_FLOOR,1.0);
 return vec4f(0.0,0.0,0.0,r*r);
}
fn reflectionCoat(V:vec3f,P:vec3f)->vec3f{
 if(!lobes.on||lobes.coat<=0.0){return vec3f(0.0);}
 let r=clamp(lobes.coatRough,ROUGHNESS_FLOOR,1.0);
 let a=r*r;
 let field=reflectionField(P,lobes.coatN,reflectionLobeOf(reflect(-V,lobes.coatN),a,vec4f(0.0,0.0,0.0,a)));
 return lobes.coat*field*reflectionWeight(vec3f(0.0),0.0,r,lobes.coatN,V);
}`
    : `fn reflectionLobe(rough:f32)->vec4f{let r=clamp(rough,ROUGHNESS_FLOOR,1.0);return vec4f(0.0,0.0,0.0,r*r);}
fn reflectionCoat(V:vec3f,P:vec3f)->vec3f{return vec3f(0.0);}`
}`,
  )

/** A forward program's reflection (blend, water), inline in its fragment stage, its resources in
 *  bind group `group`: `surfaceReflection` the blend's, `reflectedRadiance` traced here, weighed
 *  and coated as the opaque resolve's (`reflectionShare`). */
export const forwardReflectionWgsl = (group: number, lobes: boolean) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes})`,
    [reflectedRadianceWgsl(group), reflectionWeightWgsl(lobes, true)],
    `fn surfaceReflection(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!reflects()){return vec3f(0.0);}
 return reflectionShare(reflectedRadiance(P,N,V,rough,reflectionLobe(rough)),reflectionCoat(V,P),rgb,metal,rough,N,V);
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

/** The opaque resolve's binding of the reflection's view (`REFLECTION_VIEW_WGSL`), whose
 *  surroundings its coat's field holds. */
export const REFLECTION_VIEW_BINDING = 34

/** The opaque resolve's reflection: the radiance the compute pass traced for its pixel, weighed as
 *  a forward program weighs its own (`reflectionShare`); `probes`, the program binds the bounce
 *  cascades. */
export const resolvedReflectionWgsl = (lobes: boolean, probes: boolean) =>
  wgslBlock(
    `resolvedReflectionWgsl(${lobes}, ${probes})`,
    [REFLECTION_VIEW_WGSL, reflectionWeightWgsl(lobes, probes)],
    `${REFLECTION_TARGET.wgsl}
@group(0) @binding(${REFLECTION_VIEW_BINDING}) var<uniform> reflectionView:ReflectionView;
fn resolvedReflection(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!reflects()){return vec3f(0.0);}
 return reflectionShare(textureLoad(reflectionTarget,coord).rgb,reflectionCoat(V,P),rgb,metal,rough,N,V);
}`,
  )
