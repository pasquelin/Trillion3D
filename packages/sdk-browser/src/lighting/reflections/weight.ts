import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import {
  DIELECTRIC_F0,
  f0Of,
  lambertDiffuse,
  ndotvClamped,
} from '../../../../math/src/wgsl/lighting.ts'
import { BOUNCE_APPLY_WGSL } from '../bounce/applyWgsl.ts'
import { REFLECTION_LOBE_WGSL, REFLECTION_PROBES_SHARE_WGSL, SURFACE_PROBES_WGSL } from './field.ts'
import { LOBE_AXIS_WGSL, reflectionLobeWgsl } from '../lobeAxisWgsl.ts'
import { LTC_WGSL } from '../direct/rectLightWgsl.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { REFLECTION_FIELD_OVER_WGSL, REFLECTION_FIELD_STAGE_WGSL } from './wgsl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { reflectionFrontWgsl } from './viewLayout.ts'

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

/** How far a fragment's depth may lie from the front depth and still be that surface (`forwardTrace`):
 *  the two float depths' bit patterns at most this many last-place units apart — a relative 2⁻¹³ of
 *  the depth, whatever its magnitude —, against the front pass's stored
 *  depth, unbiased as a fragment's own position (`stageDescriptors`): far under the depth between a
 *  pane's two faces. */
const FRONT_DEPTH_THRESHOLD = 1024

/**
 * A forward program's reflection (blend, water), inline in its fragment stage, its resources in
 * bind group `group` and the front's traced radiance at binding `traced` of group 0
 * (`frontLayer.ts`). `forwardTrace` is what a fragment's lobes reflect: where it is the front surface
 * of its pixel — its depth the front pass's there, in an image whose trace answered the front —, the
 * radiance the trace's last pass wrote for that pixel, one load — the one chain, cached; anywhere else —
 * a surface behind the front, an image whose trace did not answer it —, the chain's last stage alone
 * (`reflectionFieldOf`): the probes and the environment through each lobe, only the front layer being
 * worth a traced ray, the layers behind it seen through it. No forward fragment
 * casts a ray: the proxy is the trace's alone, and the fragment stage keeps within the sixteen sampled
 * textures WebGPU guarantees. `surfaceReflection` is the blend's, weighed on the
 * reflectance `f0` as the opaque trace's is.
 */
const forwardReflectionWgsl = (group: number, lobes: boolean, traced: number) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes}, ${traced})`,
    [
      reflectionWeighWgsl(lobes),
      reflectionFieldLobesWgsl(lobes),
      reflectionFrontWgsl(group),
      surfaceReflects,
      FRONT_PACK_WGSL,
    ],
    `@group(0) @binding(${traced}) var frontTraced:texture_2d<u32>;
const FRONT_DEPTH_THRESHOLD:u32=${FRONT_DEPTH_THRESHOLD}u;
/** Whether the depth \`z\` at pixel \`at\` is the front pass's there: the bit patterns of two depths of
 *  the view, never negative, within \`FRONT_DEPTH_THRESHOLD\` units. */
fn frontDepthMatches(at:vec2i,z:f32)->bool{
 let a=bitcast<u32>(reflectionFrontDepth(at));
 let b=bitcast<u32>(z);
 return max(a,b)-min(a,b)<=FRONT_DEPTH_THRESHOLD;
}
/** Whether a fragment at framebuffer \`position\` is the front surface its pixel's trace answered,
 *  where \`front\` lets it be one; and what it wrote there. */
fn forwardFront(position:vec4f,front:bool)->bool{
 return front&&reflectionFrontTraced()&&frontDepthMatches(vec2i(position.xy),position.z);
}
fn forwardFrontTraced(position:vec4f)->Reflected{
 let t=textureLoad(frontTraced,vec2i(position.xy),0);
 return Reflected(frontUnpack(t.x),frontUnpack(t.y));
}
/** What a fragment at framebuffer \`position\` reflects of \`P\`, of normal \`N\` and roughness \`rough\`, seen from
 *  \`V\`: the front's traced radiance where \`front\` lets it be the front surface and its depth is that one's. */
fn forwardTrace(P:vec3f,N:vec3f,V:vec3f,rough:f32,position:vec4f,front:bool)->Reflected{
 if(forwardFront(position,front)){return forwardFrontTraced(position);}
 return reflectionFieldOf(P,N,V,rough);
}
fn surfaceReflection(f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f,position:vec4f)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return reflectionShare(forwardTrace(P,N,V,rough,position,true),f0,rough,N,V);
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
 *  `resolvedReflectionTexel`, zero where the surface reflects nothing. */
export const resolvedReflectionWgsl = wgslBlock(
  'resolvedReflectionWgsl',
  [surfaceReflects],
  `${REFLECTION_TARGET.wgsl}
fn resolvedReflectionTexel(coord:vec2i)->vec4f{
 if(!surfaceReflects(surfaceModel)){return vec4f(0.0);}
 return textureLoad(reflectionTarget,coord);
}
fn resolvedReflection(coord:vec2i)->vec3f{return resolvedReflectionTexel(coord).rgb;}`,
)

/**
 * The bounce program's indirect light at the pixel \`coord\` (`resolvedIndirect`): its bounce
 * (`bounceLighting`) and its reflection (`resolvedReflection`), a column each. Where the trace left
 * the base lobe's probes to it (`REFLECTION_PROBES_LEFT`), one gather of the probes answers both
 * (`surfaceProbesGathered`): the irradiance the diffuse reads and the radiance through the base lobe,
 * on the same weights, its share as the field's (`reflectionField`) beyond the surroundings, weighed on
 * the pixel's reflectance under its coat as the trace's last pass weighs it (`reflectionShare`) — the
 * diffuse and the rough specular from one read of the probes, not two. The host lists the lobes' variant of
 * `reflectionLobe` and `lobeThrough`.
 */
export const RESOLVED_INDIRECT_WGSL = wgslBlock(
  'RESOLVED_INDIRECT_WGSL',
  [
    resolvedReflectionWgsl,
    REFLECTION_PROBES_LEFT_WGSL,
    BOUNCE_APPLY_WGSL,
    SURFACE_PROBES_WGSL,
    REFLECTION_PROBES_SHARE_WGSL,
    REFLECTION_BASE_LOBE_WGSL,
    REFLECTION_WEIGHT_WGSL,
    lambertDiffuse,
    f0Of,
  ],
  `fn resolvedIndirect(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->mat2x3f{
 let traced=resolvedReflectionTexel(coord);
 if(traced.a!=REFLECTION_PROBES_LEFT){return mat2x3f(bounceLighting(rgb,metal,N,P,ao),traced.rgb);}
 let probes=surfaceProbesGathered(P,N,reflectionBaseLobe(N,V,rough));
 // The surroundings the trace left in the pixel give way to the probes where these hold the sky.
 let under=select(vec3f(0.0),min(probes[1].w,1.0)*skyRadiance(reflect(-V,N)),skyLit());
 return mat2x3f(lambertDiffuse(rgb,metal,indirectGathered(probes[0],N),ao),traced.rgb+(reflectionProbesShare(probes[1])-under)*reflectionWeight(f0Of(rgb,metal),rough,N,V)*lobeThrough());
}`,
)

/**
 * A forward fragment's indirect light (`forwardIndirect`, the blend's): its bounce and its reflection
 * weighed on the reflectance `f0` (`surfaceReflection`), a column each. Where the reflection is the
 * field's base lobe — a fragment behind the front surface —, one gather of the probes answers both
 * (`surfaceProbesGathered`), on the same weights: the very sums of the two reads.
 */
export const forwardIndirectWgsl = (group: number, lobes: boolean, traced: number) =>
  wgslBlock(
    `forwardIndirectWgsl(${group}, ${lobes}, ${traced})`,
    [
      forwardReflectionWgsl(group, lobes, traced),
      SURFACE_PROBES_WGSL,
      REFLECTION_FIELD_OVER_WGSL,
      lambertDiffuse,
    ],
    `fn forwardIndirect(rgb:vec3f,metal:f32,f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f,position:vec4f,ao:f32)->mat2x3f{
 if(!surfaceReflects(surfaceModel)){return mat2x3f(bounceLighting(rgb,metal,N,P,ao),vec3f(0.0));}
 if(forwardFront(position,true)){
  return mat2x3f(bounceLighting(rgb,metal,N,P,ao),reflectionShare(forwardFrontTraced(position),f0,rough,N,V));
 }
 let probes=surfaceProbesGathered(P,N,reflectionBaseLobe(N,V,rough));
 let seen=Reflected(reflectionFieldOver(probes[1],reflect(-V,N)),reflectionFieldCoat(P,V));
 return mat2x3f(lambertDiffuse(rgb,metal,indirectGathered(probes[0],N),ao),reflectionShare(seen,f0,rough,N,V));
}`,
  )
