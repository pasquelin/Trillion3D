import { DEFERRED_BINDINGS } from '../lighting/deferred/bindings.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { DIELECTRIC_F0, ndotvClamped } from '../../../math/src/wgsl/lighting.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { LTC_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { proxyKey } from './proxy.ts'
import type { RuntimeBindings } from '../bounce/runtimeAnswerWgsl.ts'
import { SHARED_EXPONENT_WGSL } from '../bounce/sharedExponentWgsl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

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
 * program without lobes has no coat and a round lobe. With `runtime`, the store the trace answers the
 * proxy from, the chain holds the proxy's stage (`reflectedRadianceWgsl`); without, it has none.
 */
export const reflectionShareWgsl = (group: number, lobes: boolean, runtime?: RuntimeBindings) =>
  wgslBlock(
    `reflectionShareWgsl(${group}, ${lobes}, ${runtime ? proxyKey(runtime) : 'none'})`,
    [reflectedRadianceWgsl(group, runtime), LTC_WGSL, LOBE_AXIS_WGSL, ndotvClamped, DIELECTRIC_F0],
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

/** How far a fragment's depth may lie from the front depth the trace read and still be that surface
 *  (`forwardTrace`), relative to it: eight times the transparent passes' depth bias (16 units of a
 *  float depth's last bit, 2⁻¹⁹ of it, `TRANSPARENT_DEPTH_LAYER`), far under the depth between a pane's
 *  two faces (a centimetre at a hundred metres is 10⁻⁴ of it). */
const FRONT_DEPTH_MATCH = 2 ** -16

/**
 * A forward program's reflection (blend, water), inline in its fragment stage, its resources in
 * bind group `group` and the front's traced radiance at binding `traced` of group 0
 * (`frontLayer.ts`). `forwardTrace` is what a fragment's lobes reflect: where it is the front surface
 * of its pixel — its depth the one the trace wrote there, by this image's front pass —, the radiance
 * the trace wrote, one load; anywhere else — a surface behind the front, an image without a front
 * pass —, the chain without the proxy's stage (`reflectionTrace`): the screen, the probes and the
 * environment, never a ray of the proxy. `surfaceReflection` is the blend's, weighed on the
 * reflectance `f0` as the opaque trace's is; the water traces once (`forwardTrace`) and weighs the one
 * trace on two reflectances (`reflectionShare`).
 */
export const forwardReflectionWgsl = (group: number, lobes: boolean, traced: number) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes}, ${traced})`,
    [reflectionShareWgsl(group, lobes), surfaceReflects, SHARED_EXPONENT_WGSL],
    `@group(0) @binding(${traced}) var frontTraced:texture_2d<u32>;
const FRONT_DEPTH_MATCH:f32=${wgslF32(FRONT_DEPTH_MATCH)};
/** What a fragment at framebuffer \`position\` reflects of \`P\`, of normal \`N\` and roughness \`rough\`, seen from
 *  \`V\`: the front's traced radiance where \`front\` lets it be the front surface and its depth is that one's. */
fn forwardTrace(P:vec3f,N:vec3f,V:vec3f,rough:f32,position:vec4f,front:bool)->Reflected{
 if(front&&reflectionView.runtime.y!=0u){
  let t=textureLoad(frontTraced,vec2i(position.xy),0);
  if(t.w==reflectionView.runtime.y&&abs(bitcast<f32>(t.z)-position.z)<=position.z*FRONT_DEPTH_MATCH){
   return Reflected(rtUnpackShared(t.x),rtUnpackShared(t.y));
  }
 }
 return reflectionTrace(P,N,V,rough);
}
fn surfaceReflection(f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f,position:vec4f)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return reflectionShare(forwardTrace(P,N,V,rough,position,true),f0,rough,N,V);
}`,
  )

/** The reflection target, read by load alone by the opaque resolve. */
export const REFLECTION_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.reflection,
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
