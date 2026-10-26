import { AMBIENT_SPECULAR_OCCLUSION_WGSL } from '../deferred/ambientOcclusionWgsl.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { DIELECTRIC_F0, ndotvClamped, specularF90 } from '../../../../math/src/wgsl/lighting.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { BOUNCE_APPLY_WGSL } from '../bounce/applyWgsl.ts'
import { SCREEN_INDIRECT_WGSL } from '../bounce/screen/indirectWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { LOBE_AXIS_WGSL, reflectionLobeWgsl } from '../lobeAxisWgsl.ts'
import { ENVIRONMENT_BRDF_WGSL } from '../direct/environmentBrdfWgsl.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { REFLECTION_FIELD_STAGE_WGSL } from './wgsl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { SKY_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'

/** What a surface's lobes reflect: the base lobe's radiance and the clear coat's. */
const REFLECTED_WGSL = wgslStruct('Reflected', [], 'struct Reflected{base:vec3f,coat:vec3f,}')

/**
 * What a lit surface keeps of the radiance it reflects (`reflectionWeighWgsl`). `reflectionWeight`
 * is the preintegrated environment BRDF of its GGX lobe at its roughness and N·V (`environmentBrdf`, in every
 * lighting program), on its reflectance `f0`: `surfaceF0` of its colour and metalness, a dielectric's on a coat, the water's own.
 * `Reflected` is what its lobes reflect, the radiance of each: the base lobe's and, where the surface
 * carries a clear coat, the coat's. `reflectionShare` is that radiance weighed on a reflectance, the
 * the base's weighed under the coat as the clear coat model's layers combine (`hasCoat`), and the coat's added. A program
 * without lobes has no coat and a round lobe. The reflections' last pass weighs each pixel here, on
 * its own reflectance (`bilateralWgsl.ts`).
 */
const REFLECTION_WEIGHT_WGSL = wgslBlock(
  'REFLECTION_WEIGHT_WGSL',
  [ENVIRONMENT_BRDF_WGSL, LOBE_AXIS_WGSL, ndotvClamped],
  `fn reflectionWeight(f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return environmentBrdf(f0,lobeRoughness(rough),ndotvClamped(N,V));
}`,
)
export const reflectionWeighWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionWeighWgsl(${lobes})`,
    [REFLECTED_WGSL, REFLECTION_WEIGHT_WGSL, DIELECTRIC_F0, specularF90],
    `${
      lobes
        ? `fn reflectionBaseShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 if(!hasCoat()){return traced.base*reflectionWeight(f0,rough,N,V);}
 // The coat's layers combined: the base's reflection weighed on the coat's reflectance, the grazing part of
 // its environment BRDF scaled by what the coat leaves, and what the coat lets through (one minus its own).
 let ab=environmentBrdfPair(lobeRoughness(rough),ndotvClamped(N,V));
 let base=f0*ab.x+vec3f(specularF90(f0)*ab.y*(1.0-lobes.coat));
 let F=lobes.coat*reflectionWeight(DIELECTRIC_F0,lobes.coatRough,lobes.coatN,V).x;
 return traced.base*base*(1.0-F);
}
fn reflectionCoatShare(traced:Reflected,V:vec3f)->vec3f{
 if(!hasCoat()){return vec3f(0.0);}
 return traced.coat*lobes.coat*reflectionWeight(DIELECTRIC_F0,lobes.coatRough,lobes.coatN,V).x;
}`
        : `fn reflectionBaseShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return traced.base*reflectionWeight(f0,rough,N,V);
}
fn reflectionCoatShare(traced:Reflected,V:vec3f)->vec3f{return vec3f(0.0);}`
    }
fn reflectionShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return reflectionBaseShare(traced,f0,rough,N,V)+reflectionCoatShare(traced,V);
}`,
  )

/** The base lobe a surface of normal `N` and roughness `rough` seen from `V` reflects through
 *  (`reflectionBaseLobe`): around its mirror direction, at the narrower width the lights read
 *  (`reflectionAcross`, which its host lists in its lobes' variant). */
const REFLECTION_BASE_LOBE_WGSL = wgslBlock(
  'REFLECTION_BASE_LOBE_WGSL',
  [REFLECTION_LOBE_WGSL, LOBE_AXIS_WGSL],
  `fn reflectionBaseLobe(N:vec3f,V:vec3f,rough:f32)->ReflectionLobe{
 return reflectionLobeOf(reflect(-V,N),reflectionAcross(rough));
}`,
)

/**
 * The ray a surface casts, sampled by `u` (`sampleWgsl.ts`): one a pixel, of the lobe it traces — its
 * top layer, the sharpest lobe it shows —: where the surface carries a clear coat (`lobes.coat`), the coat's own dielectric lobe on
 * its normal and roughness (`reflectionCoatRay`); elsewhere the base lobe (`reflectionBaseRay`),
 * along the lobe the lights read (`reflectionLobe`). `reflectionTopRay` picks it. The lobe under a coat
 * casts no ray: the environment answers it, the base under a coat seen through the coat's blur.
 */
export const REFLECTION_LOBE_RAYS_WGSL = wgslBlock(
  'REFLECTION_LOBE_RAYS_WGSL',
  [REFLECTION_SAMPLE_WGSL, reflectionLobeWgsl(true), LOBE_AXIS_WGSL],
  `fn reflectionBaseRay(N:vec3f,V:vec3f,rough:f32,u:vec2f)->ReflectionLobeRay{
 return reflectionLobeRay(N,V,reflectionAcross(rough),reflectionLobe(rough),u);
}
fn reflectionCoatRay(V:vec3f,u:vec2f)->ReflectionLobeRay{
 let alpha=lobeAlpha(lobes.coatRough);
 return reflectionLobeRay(lobes.coatN,V,alpha,vec4f(0.0,0.0,0.0,alpha),u);
}
fn reflectionTopRay(N:vec3f,V:vec3f,rough:f32,u:vec2f)->ReflectionLobeRay{
 if(lobes.on&&lobes.coat>0.0){return reflectionCoatRay(V,u);}
 return reflectionBaseRay(N,V,rough,u);
}`,
)

/**
 * What a surface's lobes reflect of the environment alone (`reflectionEnvironmentOf`): the radiance around the scene through the base lobe
 * at the narrower width the lights read and, where the surface carries a clear coat, through the coat's, each held to a ray's ceiling
 * (`reflectionField`). What the front surface reads where its lobe traces nothing in the trace's last pass (`bilateralWgsl.ts`), the base lobe
 * under a traced coat there, and what a forward fragment that is not the front surface of its pixel reflects: the layers behind the front are
 * seen through it, and the traced front is the only one worth a ray.
 */
export const reflectionEnvironmentLobesWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionEnvironmentLobesWgsl(${lobes})`,
    [
      REFLECTED_WGSL,
      reflectionLobeWgsl(lobes),
      REFLECTION_BASE_LOBE_WGSL,
      REFLECTION_FIELD_STAGE_WGSL,
      LOBE_AXIS_WGSL,
    ],
    `${
      lobes
        ? `fn reflectionEnvironmentCoat(V:vec3f)->vec3f{
 if(!(lobes.on&&lobes.coat>0.0)){return vec3f(0.0);}
 let c=lobeAlpha(lobes.coatRough);
 return reflectionField(reflectionLobeOf(reflect(-V,lobes.coatN),c));
}`
        : `fn reflectionEnvironmentCoat(V:vec3f)->vec3f{return vec3f(0.0);}`
    }
fn reflectionEnvironmentOf(N:vec3f,V:vec3f,rough:f32)->Reflected{
 return Reflected(reflectionField(reflectionBaseLobe(N,V,rough)),reflectionEnvironmentCoat(V));
}`,
  )

/** The layers of the reflection target: the base lobe's share with its alpha, and the coat's share. */
export const REFLECTION_TARGET_LAYERS = 2
/** The reflection target, read by load alone by the opaque resolve. Its layer 0 holds the share of the
 *  base lobe (the whole reflection where the surface has no coat) and its alpha, its layer 1 the coat's
 *  share, which the specular occlusion leaves as it is: only the base lobe, the rough part, goes under it. */
export const REFLECTION_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.reflection,
  HDR_FORMAT,
  'reflectionTarget',
  REFLECTION_TARGET_LAYERS,
)

/** The reflection target's alpha where the trace's last pass traced no ray for the opaque pixel
 *  (`bilateralWgsl.ts`): its colour then holds the surroundings through the base lobe and through the
 *  coat, and the resolve adds the rough light of the screen probes (`resolvedIndirect`). A pixel whose lobe a ray answers in part
 *  writes that share, in (0, 1], and its colour holds the surroundings for the rest (`reflectionLeftShare`: what the screen probes add
 *  of); a target never written, or a pixel that reflects nothing, reads zero. */
const REFLECTION_PROBES_LEFT = -1
export const REFLECTION_PROBES_LEFT_WGSL = wgslBlock(
  'REFLECTION_PROBES_LEFT_WGSL',
  [],
  `const REFLECTION_PROBES_LEFT:f32=${wgslF32(REFLECTION_PROBES_LEFT)};
/** The share of a pixel's reflection left to the screen probes, from the alpha \`alpha\` of its texel: all of it where flagged, what a
 *  ray did not answer where the texel holds the share that did, none where it holds none. */
fn reflectionLeftShare(alpha:f32)->f32{
 if(alpha==REFLECTION_PROBES_LEFT){return 1.0;}
 return select(0.0,1.0-alpha,alpha>0.0);
}`,
)

/** The opaque resolve's reflection: the share the compute pass accumulated for its pixel, weighed and
 *  coated there (`reflectionShare`), added as it is — its texel with its alpha in
 *  `resolvedReflectionTexel`, zero where the surface reflects nothing —, but for a pixel the field answered
 *  (`REFLECTION_PROBES_LEFT`), which goes under the occlusion `occluded` (`ambientSpecularOcclusion`,
 *  `resolvedReflection`): no ray answered it. The coat's share (layer 1) is added after it, never occluded: the occlusion
 *  reaches the rough, bottom lobe alone. */
export const resolvedReflectionWgsl = wgslBlock(
  'resolvedReflectionWgsl',
  [surfaceReflects, REFLECTION_PROBES_LEFT_WGSL, AMBIENT_SPECULAR_OCCLUSION_WGSL],
  `${REFLECTION_TARGET.wgsl}
fn resolvedReflectionTexel(coord:vec2i)->vec4f{
 if(!surfaceReflects(surfaceModel)){return vec4f(0.0);}
 return textureLoad(reflectionTarget,coord,0);
}
/** The coat's share of the pixel's reflection, which the occlusion leaves whole. */
fn resolvedReflectionCoat(coord:vec2i)->vec3f{
 if(!hasCoat()||!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return textureLoad(reflectionTarget,coord,1).rgb;
}
fn resolvedReflection(coord:vec2i,occluded:f32,N:vec3f,V:vec3f,rough:f32)->vec3f{
 let traced=resolvedReflectionTexel(coord);
 let coat=resolvedReflectionCoat(coord);
 if(traced.a!=REFLECTION_PROBES_LEFT){return traced.rgb+coat;}
 return traced.rgb*ambientSpecularOcclusion(occluded,N,V,rough)+coat;
}`,
)

/**
 * The same under the sky light's distance-field occlusion (`resolvedReflectionOccluded`): what the field alone answers — the
 * surroundings through the base lobe, flagged `REFLECTION_PROBES_LEFT` — is the sky light's specular light, which the bent normal
 * occludes (`skySpecular`, and `skyAdd` the occlusion's tint times what it lost, weighed on the pixel's reflectance as the
 * light it stands for, `reflectionWeight`); what the screen and the trace of the scene answered, hits of the
 * scene and not the sky, is left as it is. Both go under the occlusion of the material and the screen (`ambientSpecularOcclusion`),
 * as the reflection's remaining share does.
 */
export const resolvedReflectionOccludedWgsl = wgslBlock(
  'resolvedReflectionOccludedWgsl',
  [resolvedReflectionWgsl, REFLECTION_WEIGHT_WGSL, SURFACE_F0_WGSL],
  `fn resolvedReflectionOccluded(coord:vec2i,rgb:vec3f,metal:f32,occluded:f32,N:vec3f,V:vec3f,rough:f32,skySpecular:f32,skyAdd:vec3f)->vec3f{
 let traced=resolvedReflectionTexel(coord);
 let coat=resolvedReflectionCoat(coord);
 if(traced.a!=REFLECTION_PROBES_LEFT){return traced.rgb+coat;}
 let left=ambientSpecularOcclusion(occluded,N,V,rough);
 let tint=skyAdd*reflectionWeight(indirectF0(rgb,metal),rough,N,V)*coatLayerKeep();
 return (traced.rgb*skySpecular+tint)*left+coat;
}`,
)

/**
 * The bounce program's indirect light at the pixel `coord` (`resolvedIndirect`): its bounce and its reflection, a column
 * each. The bounce is the screen probes' light where they read the pixel (`screenDiffuse`), the sky light's otherwise
 * (`bounceLighting`), under the screen probes' occlusion alone where the level casts none (`screenShortRange`). The reflection
 * is the trace's (`resolvedReflection`) but for the share of the base lobe the trace left to the resolve (`reflectionLeftShare`: the
 * whole of it where flagged `REFLECTION_PROBES_LEFT`, no ray being traced for that pixel, the share no ray answered of a lobe the
 * roughness lets trace in part): the light of that share is the screen probes' (`screenRoughAt`, four points of its
 * lobe in their radiance) under the specular occlusion their bent normal gives (`screenSpecularOcclusion`), weighed on the
 * pixel's reflectance under its coat as the trace's last pass weighs a reflection (`reflectionShare`); the surroundings the
 * trace left in the pixel give way to it where the probes hold the sky. A pixel the screen probes did not read has the
 * surroundings alone. What the surroundings and the probes give goes under the occlusion `occluded` (`ambientSpecularOcclusion`),
 * as the one `resolvedReflection` leaves to the environment does. The host lists the lobes' variant of `coatLayerKeep`.
 */
export const RESOLVED_INDIRECT_WGSL = wgslBlock(
  'RESOLVED_INDIRECT_WGSL',
  [
    resolvedReflectionWgsl,
    SKY_READ_WGSL,
    REFLECTION_PROBES_LEFT_WGSL,
    AMBIENT_SPECULAR_OCCLUSION_WGSL,
    BOUNCE_APPLY_WGSL,
    SCREEN_INDIRECT_WGSL,
    REFLECTION_WEIGHT_WGSL,
    SURFACE_F0_WGSL,
  ],
  `fn resolvedIndirect(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,occluded:f32)->mat2x3f{
 let traced=resolvedReflectionTexel(coord);
 let coat=resolvedReflectionCoat(coord);
 // The pixel the screen probes read takes their light; where they left none, the sky light's, under their occlusion alone where
 // the level casts no probe (screenShortRange).
 let seen=screenIndirectAt(coord);
 let screened=screenLights(seen);
 // A cloth's fuzz joins its diffuse colour (\`clothDiffuse\`), the multi-bounce occlusion included.
 let colour=clothDiffuse(rgb,metal);
 var diffuse:vec3f;
 if(screened){diffuse=screenDiffuse(colour.rgb,colour.w,seen,ao);}
 else{diffuse=bounceLighting(colour.rgb,colour.w,N,P,ao)*screenShortRange(colour.rgb,colour.w,seen);}
 let left=reflectionLeftShare(traced.a);
 if(left==0.0){return mat2x3f(diffuse,traced.rgb+coat);}
 // No ray answered a share of this pixel: the surroundings the trace left in it for that share, and the screen probes' rough specular
 // where they read it, which holds the sky where a sky light shines, so the surroundings give way to it.
 var probes=vec3f(0.0);
 if(screened){
  let under=select(vec3f(0.0),skyRadianceAt(reflect(-V,N),rough),skyLit());
  let light=screenRoughAt(coord)*screenSpecularOcclusion(coord,N,V,rough);
  probes=(light-under)*reflectionWeight(indirectF0(rgb,metal),rough,N,V)*coatLayerKeep()*left;
 }
 let occlusion=ambientSpecularOcclusion(occluded,N,V,rough);
 return mat2x3f(diffuse,(traced.rgb*mix(1.0,occlusion,left)+probes*occlusion)+coat);
}`,
)
