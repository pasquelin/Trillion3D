import { DEFERRED_BINDINGS } from '../lighting/deferred/bindings.ts'
import { wgslBlock, wgslStruct } from '../../../math/src/wgsl/decl.ts'
import { DIELECTRIC_F0, ndotvClamped } from '../../../math/src/wgsl/lighting.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { LTC_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { REFLECTION_CENTRE_WGSL, REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { sceneKey, type SceneBindings } from '../bounce/sceneBindings.ts'
import { SHARED_EXPONENT_WGSL } from '../bounce/sharedExponentWgsl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { reflectionFrontWgsl } from './viewLayout.ts'
import { TRANSPARENT_DEPTH_LAYER, depthLayerUnits } from '../../../sdk-core/src/lod/depthLayer.ts'

/** What a surface's lobes reflect: the base lobe's radiance and the clear coat's. */
export const REFLECTED_WGSL = wgslStruct(
  'Reflected',
  [],
  'struct Reflected{base:vec3f,coat:vec3f,}',
)

/**
 * What a lit surface keeps of the radiance it reflects (`reflectionWeighWgsl`). `reflectionWeight`
 * is the engine's split-sum term of its GGX lobe at its roughness and N·V (the fitted magnitude and
 * Fresnel share the rectangle lights read, `ltcSplitSum`, in every lighting program), on its
 * reflectance `f0`: `f0Of` of its colour and metalness, a dielectric's on a coat, the water's own.
 * `Reflected` is what its lobes reflect, the radiance of each: the base lobe's and, where the surface
 * carries a clear coat, the coat's. `reflectionShare` is that radiance weighed on a reflectance, the
 * base let through the coat as every other term is (`lobeThrough`), and the coat's added. A program
 * without lobes has no coat and a round lobe. The reflections' upsample weighs each full-resolution
 * pixel here, on its own reflectance (`upsampleWgsl.ts`).
 */
export const reflectionWeighWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionWeighWgsl(${lobes})`,
    [REFLECTED_WGSL, LTC_WGSL, LOBE_AXIS_WGSL, ndotvClamped, DIELECTRIC_F0],
    `fn reflectionWeight(f0:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return ltcSplitSum(f0,lobeRoughness(rough),ndotvClamped(N,V));
}
${
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

/**
 * How a surface traces what its lobes reflect (`reflectionTrace`), the radiance of each traced once
 * (`Reflected`): the base lobe's, along the lobe the lights read (`reflectionLobe`: the long axis
 * `setLobes` left — its direction and αt where the material is anisotropic, a round lobe elsewhere),
 * and, where the surface carries a clear coat, the coat's own dielectric lobe on its normal and
 * roughness, only where the coat is above zero; the base's hit stays the reflection's (`reflectionHit`).
 * Each lobe is one `reflectionLobeRadiance`. With `scene`, the proxy's bindings — the reflections' trace
 * alone —, the chain holds the proxy's stage (`reflectedRadianceWgsl`) and a glossy lobe is sampled by
 * `u` (`sampleWgsl.ts`); without, a lobe is read along its centre, `u` unread, and the chain has no
 * proxy's stage.
 */
export const reflectionShareWgsl = (group: number, lobes: boolean, scene?: SceneBindings) =>
  wgslBlock(
    `reflectionShareWgsl(${group}, ${lobes}, ${scene ? sceneKey(scene) : 'none'})`,
    [
      reflectedRadianceWgsl(group, scene),
      scene ? REFLECTION_SAMPLE_WGSL : REFLECTION_CENTRE_WGSL,
      reflectionWeighWgsl(lobes),
      LOBE_AXIS_WGSL,
    ],
    lobes
      ? `fn reflectionLobe(rough:f32)->vec4f{
 if(lobes.on){return vec4f(lobes.T,lobes.at);}
 return vec4f(0.0,0.0,0.0,lobeAlpha(rough));
}
fn reflectionTrace(P:vec3f,N:vec3f,V:vec3f,rough:f32,u:vec2f)->Reflected{
 var traced=Reflected(reflectionLobeRadiance(P,N,V,lobeAlpha(rough),reflectionLobe(rough),u),vec3f(0.0));
 if(lobes.on&&lobes.coat>0.0){
  let hit=reflectionHit;
  let alpha=lobeAlpha(lobes.coatRough);
  traced.coat=reflectionLobeRadiance(P,lobes.coatN,V,alpha,vec4f(0.0,0.0,0.0,alpha),u.yx);
  reflectionHit=hit;
 }
 return traced;
}`
      : `fn reflectionLobe(rough:f32)->vec4f{return vec4f(0.0,0.0,0.0,lobeAlpha(rough));}
fn reflectionTrace(P:vec3f,N:vec3f,V:vec3f,rough:f32,u:vec2f)->Reflected{
 return Reflected(reflectionLobeRadiance(P,N,V,lobeAlpha(rough),reflectionLobe(rough),u),vec3f(0.0));
}`,
  )

/** How far a fragment's depth may lie from the front depth and still be that surface (`forwardTrace`),
 *  relative to it: eight times the transparent passes' depth bias (`TRANSPARENT_DEPTH_LAYER`, in units of
 *  a float depth's last bit, 2⁻²³ of it), far under the depth between a pane's two faces (a centimetre at
 *  a hundred metres is 10⁻⁴ of it). */
const FRONT_DEPTH_MATCH = 8 * depthLayerUnits(TRANSPARENT_DEPTH_LAYER) * 2 ** -23

/**
 * A forward program's reflection (blend, water), inline in its fragment stage, its resources in
 * bind group `group` and the front's traced radiance at binding `traced` of group 0
 * (`frontLayer.ts`). `forwardTrace` is what a fragment's lobes reflect: where it is the front surface
 * of its pixel — its depth the front pass's there, in an image whose trace answered the front —, the
 * radiance the trace's upsample wrote for that pixel, one load; anywhere else — a surface behind the front, an image whose trace
 * did not answer it —, the chain without the proxy's stage (`reflectionTrace`): the screen, the probes
 * and the environment, never a ray of the proxy. `surfaceReflection` is the blend's, weighed on the
 * reflectance `f0` as the opaque trace's is; the water traces once (`forwardTrace`) and weighs the one
 * trace on two reflectances (`reflectionShare`).
 */
export const forwardReflectionWgsl = (group: number, lobes: boolean, traced: number) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes}, ${traced})`,
    [
      reflectionShareWgsl(group, lobes),
      reflectionFrontWgsl(group),
      surfaceReflects,
      SHARED_EXPONENT_WGSL,
    ],
    `@group(0) @binding(${traced}) var frontTraced:texture_2d<u32>;
const FRONT_DEPTH_MATCH:f32=${wgslF32(FRONT_DEPTH_MATCH)};
/** What a fragment at framebuffer \`position\` reflects of \`P\`, of normal \`N\` and roughness \`rough\`, seen from
 *  \`V\`: the front's traced radiance where \`front\` lets it be the front surface and its depth is that one's. */
fn forwardTrace(P:vec3f,N:vec3f,V:vec3f,rough:f32,position:vec4f,front:bool)->Reflected{
 let at=vec2i(position.xy);
 if(front&&reflectionFrontTraced()&&abs(reflectionFrontDepth(at)-position.z)<=position.z*FRONT_DEPTH_MATCH){
  let t=textureLoad(frontTraced,at,0);
  return Reflected(rtUnpackShared(t.x),rtUnpackShared(t.y));
 }
 return reflectionTrace(P,N,V,rough,vec2f(0.0));
}
fn surfaceReflection(f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f,position:vec4f)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return reflectionShare(forwardTrace(P,N,V,rough,position,true),f0,rough,N,V);
}`,
  )

/** The reflection target, read by load alone by the opaque resolve. */
export const REFLECTION_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.reflection,
  REFLECTION_FORMAT,
  'reflectionTarget',
)

/** The opaque resolve's reflection: the share the compute pass upsampled for its pixel, weighed and
 *  coated there (`reflectionShare`), added as it is. */
export const resolvedReflectionWgsl = wgslBlock(
  'resolvedReflectionWgsl',
  [surfaceReflects],
  `${REFLECTION_TARGET.wgsl}
fn resolvedReflection(coord:vec2i)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return textureLoad(reflectionTarget,coord).rgb;
}`,
)
