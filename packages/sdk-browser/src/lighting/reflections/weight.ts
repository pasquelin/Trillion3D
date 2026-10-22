import { AMBIENT_SPECULAR_OCCLUSION_WGSL } from '../deferred/ambientOcclusionWgsl.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import {
  DIELECTRIC_F0,
  f0Of,
  lambertDiffuse,
  ndotvClamped,
} from '../../../../math/src/wgsl/lighting.ts'
import { BOUNCE_APPLY_WGSL } from '../bounce/applyWgsl.ts'
import { SCREEN_INDIRECT_WGSL } from '../bounce/screen/indirectWgsl.ts'
import { REFLECTION_LOBE_WGSL, REFLECTION_PROBES_SHARE_WGSL, SURFACE_PROBES_WGSL } from './field.ts'
import { LOBE_AXIS_WGSL, reflectionLobeWgsl } from '../lobeAxisWgsl.ts'
import { LTC_WGSL } from '../direct/rectLightWgsl.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { REFLECTION_FIELD_STAGE_WGSL } from './wgsl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'

/** What a surface's lobes reflect: the base lobe's radiance and the clear coat's. */
const REFLECTED_WGSL = wgslStruct('Reflected', [], 'struct Reflected{base:vec3f,coat:vec3f,}')

/**
 * What a lit surface keeps of the radiance it reflects (`reflectionWeighWgsl`). `reflectionWeight`
 * is the engine's split-sum term of its GGX lobe at its roughness and N·V (the fitted magnitude and
 * Fresnel share the rectangle lights read, `ltcSplitSum`, in every lighting program), on its
 * reflectance `f0`: `f0Of` of its colour and metalness, a dielectric's on a coat, the water's own.
 * `Reflected` is what its lobes reflect, the radiance of each: the base lobe's and, where the surface
 * carries a clear coat, the coat's. `reflectionShare` is that radiance weighed on a reflectance, the
 * base let through the coat as every other term is (`lobeThrough`), and the coat's added. A program
 * without lobes has no coat and a round lobe. The reflections' last pass weighs each pixel here, on
 * its own reflectance (`bilateralWgsl.ts`).
 */
const REFLECTION_WEIGHT_WGSL = wgslBlock(
  'REFLECTION_WEIGHT_WGSL',
  [LTC_WGSL, LOBE_AXIS_WGSL, ndotvClamped],
  `fn reflectionWeight(f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return ltcSplitSum(f0,lobeRoughness(rough),ndotvClamped(N,V));
}`,
)
export const reflectionWeighWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionWeighWgsl(${lobes})`,
    [REFLECTED_WGSL, REFLECTION_WEIGHT_WGSL, DIELECTRIC_F0],
    `${
      lobes
        ? `fn reflectionShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 var share=traced.base*reflectionWeight(f0,rough,N,V)*lobeThrough();
 if(lobes.on&&lobes.coat>0.0){share+=lobes.coat*traced.coat*reflectionWeight(DIELECTRIC_F0,lobes.coatRough,lobes.coatN,V);}
 return share;
}`
        : `fn reflectionShare(traced:Reflected,f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return traced.base*reflectionWeight(f0,rough,N,V);
}`
    }`,
  )

/** The base lobe a surface of normal `N` and roughness `rough` seen from `V` reflects through
 *  (`reflectionBaseLobe`): around its mirror direction, along the lobe the lights read
 *  (`reflectionLobe`, which its host lists in its lobes' variant). */
const REFLECTION_BASE_LOBE_WGSL = wgslBlock(
  'REFLECTION_BASE_LOBE_WGSL',
  [REFLECTION_LOBE_WGSL, LOBE_AXIS_WGSL],
  `fn reflectionBaseLobe(N:vec3f,V:vec3f,rough:f32)->ReflectionLobe{
 return reflectionLobeOf(reflect(-V,N),lobeAlpha(rough),reflectionLobe(rough));
}`,
)

/**
 * The ray a surface casts, sampled by `u` (`sampleWgsl.ts`): one a pixel, of the lobe it traces — its
 * top layer, the sharpest lobe it shows —: where the surface carries a clear coat (`lobes.coat`), the coat's own dielectric lobe on
 * its normal and roughness (`reflectionCoatRay`); elsewhere the base lobe (`reflectionBaseRay`),
 * along the lobe the lights read (`reflectionLobe`). `reflectionTopRay` picks it. The lobe under a coat
 * casts no ray: the probes' field answers it (`reflectionFieldBase`), the base under a coat seen
 * through the coat's blur, rough enough for the probes.
 */
export const REFLECTION_LOBE_RAYS_WGSL = wgslBlock(
  'REFLECTION_LOBE_RAYS_WGSL',
  [REFLECTION_SAMPLE_WGSL, reflectionLobeWgsl(true), LOBE_AXIS_WGSL],
  `fn reflectionBaseRay(N:vec3f,V:vec3f,rough:f32,u:vec2f)->ReflectionLobeRay{
 return reflectionLobeRay(N,V,lobeAlpha(rough),reflectionLobe(rough),u);
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
 * What a surface's lobes reflect of the probes' field alone (the chain's last stage through each lobe
 * whole, `reflectionField`): `reflectionFieldBase`, the base lobe along the lobe the lights read
 * (`reflectionLobe`); `reflectionFieldCoat`, where the surface carries a clear coat, the coat's on its
 * normal and roughness; `reflectionFieldOf`, both. What a pixel whose lobe traces nothing reads in the
 * trace's last pass (`bilateralWgsl.ts`), the base lobe under a traced coat there, and a forward
 * fragment behind the front surface (`forwardTrace`): one rule.
 */
export const reflectionFieldLobesWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionFieldLobesWgsl(${lobes})`,
    [
      REFLECTED_WGSL,
      reflectionLobeWgsl(lobes),
      REFLECTION_BASE_LOBE_WGSL,
      REFLECTION_FIELD_STAGE_WGSL,
      LOBE_AXIS_WGSL,
    ],
    `fn reflectionFieldBase(P:vec3f,N:vec3f,V:vec3f,rough:f32)->vec3f{
 return reflectionField(P,N,reflectionBaseLobe(N,V,rough));
}${
      lobes
        ? `
fn reflectionFieldCoat(P:vec3f,V:vec3f)->vec3f{
 if(!(lobes.on&&lobes.coat>0.0)){return vec3f(0.0);}
 let c=lobeAlpha(lobes.coatRough);
 return reflectionField(P,lobes.coatN,reflectionLobeOf(reflect(-V,lobes.coatN),c,vec4f(0.0,0.0,0.0,c)));
}`
        : `
fn reflectionFieldCoat(P:vec3f,V:vec3f)->vec3f{return vec3f(0.0);}`
    }
fn reflectionFieldOf(P:vec3f,N:vec3f,V:vec3f,rough:f32)->Reflected{
 return Reflected(reflectionFieldBase(P,N,V,rough),reflectionFieldCoat(P,V));
}`,
  )

/** The reflection target, read by load alone by the opaque resolve. */
export const REFLECTION_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.reflection,
  HDR_FORMAT,
  'reflectionTarget',
)

/** The reflection target's alpha where the trace's last pass left the base lobe's probes to the opaque
 *  resolve (`bilateralWgsl.ts`): its colour then holds the rest of the share — the surroundings
 *  through the base lobe, the coat's whole —, and the resolve adds the probes, gathered with its
 *  bounce in one read (`resolvedIndirect`). Any other pixel writes one; a target never written reads
 *  zero. */
const REFLECTION_PROBES_LEFT = -1
export const REFLECTION_PROBES_LEFT_WGSL = wgslBlock(
  'REFLECTION_PROBES_LEFT_WGSL',
  [],
  `const REFLECTION_PROBES_LEFT:f32=${wgslF32(REFLECTION_PROBES_LEFT)};`,
)

/** The opaque resolve's reflection: the share the compute pass accumulated for its pixel, weighed and
 *  coated there (`reflectionShare`), added as it is — its texel with its alpha in
 *  `resolvedReflectionTexel`, zero where the surface reflects nothing —, but for a pixel the field answered
 *  (`REFLECTION_PROBES_LEFT`), which goes under the occlusion `occluded` (`ambientSpecularOcclusion`,
 *  `resolvedReflection`): no ray answered it. */
export const resolvedReflectionWgsl = wgslBlock(
  'resolvedReflectionWgsl',
  [surfaceReflects, REFLECTION_PROBES_LEFT_WGSL, AMBIENT_SPECULAR_OCCLUSION_WGSL],
  `${REFLECTION_TARGET.wgsl}
fn resolvedReflectionTexel(coord:vec2i)->vec4f{
 if(!surfaceReflects(surfaceModel)){return vec4f(0.0);}
 return textureLoad(reflectionTarget,coord);
}
fn resolvedReflection(coord:vec2i,occluded:f32,N:vec3f,V:vec3f,rough:f32)->vec3f{
 let traced=resolvedReflectionTexel(coord);
 if(traced.a!=REFLECTION_PROBES_LEFT){return traced.rgb;}
 return traced.rgb*ambientSpecularOcclusion(occluded,N,V,rough);
}`,
)

/**
 * The bounce program's indirect light at the pixel \`coord\` (`resolvedIndirect`): its bounce
 * (`bounceLighting`) and its reflection (`resolvedReflection`), a column each. Where the trace left
 * the base lobe's probes to it (`REFLECTION_PROBES_LEFT`), one gather of the probes answers both
 * (`surfaceProbesGathered`): the irradiance the diffuse reads and the radiance through the base lobe,
 * on the same weights, its share as the field's (`reflectionField`) beyond the surroundings, weighed on
 * the pixel's reflectance under its coat as the trace's last pass weighs it (`reflectionShare`) — the
 * diffuse and the rough specular from one read of the probes, not two. No ray answered that reflection: it goes
 * whole under the occlusion `occluded` (`ambientSpecularOcclusion`), as the one `resolvedReflection` leaves to the field
 * does. The host lists the lobes' variant of `reflectionLobe` and `lobeThrough`.
 */
export const RESOLVED_INDIRECT_WGSL = wgslBlock(
  'RESOLVED_INDIRECT_WGSL',
  [
    resolvedReflectionWgsl,
    REFLECTION_PROBES_LEFT_WGSL,
    AMBIENT_SPECULAR_OCCLUSION_WGSL,
    BOUNCE_APPLY_WGSL,
    SCREEN_INDIRECT_WGSL,
    SURFACE_PROBES_WGSL,
    REFLECTION_PROBES_SHARE_WGSL,
    REFLECTION_BASE_LOBE_WGSL,
    REFLECTION_WEIGHT_WGSL,
    lambertDiffuse,
    f0Of,
  ],
  `fn resolvedIndirect(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,occluded:f32)->mat2x3f{
 let traced=resolvedReflectionTexel(coord);
 // The pixel the screen probes read takes their light, the world's probes' gather skipped; where they left none, the world's,
 // under their occlusion alone where the level casts no probe (screenShortRange).
 let seen=screenIndirectAt(coord);
 let screened=screenLights(seen);
 let shortRange=screenShortRange(rgb,metal,seen);
 if(traced.a!=REFLECTION_PROBES_LEFT){
  if(screened){return mat2x3f(screenDiffuse(rgb,metal,seen,ao),traced.rgb);}
  return mat2x3f(bounceLighting(rgb,metal,N,P,ao)*shortRange,traced.rgb);
 }
 let probes=surfaceProbesGathered(P,N,reflectionBaseLobe(N,V,rough));
 // The surroundings the trace left in the pixel give way to the probes where these hold the sky.
 let under=select(vec3f(0.0),min(probes[1].w,1.0)*skyRadiance(reflect(-V,N)),skyLit());
 let diffuse=select(lambertDiffuse(rgb,metal,indirectGathered(probes[0],N),ao)*shortRange,screenDiffuse(rgb,metal,seen,ao),screened);
 let field=traced.rgb+(reflectionProbesShare(probes[1])-under)*reflectionWeight(f0Of(rgb,metal),rough,N,V)*lobeThrough();
 return mat2x3f(diffuse,field*ambientSpecularOcclusion(occluded,N,V,rough));
}`,
)
