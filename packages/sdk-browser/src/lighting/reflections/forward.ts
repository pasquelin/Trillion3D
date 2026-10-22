import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import { SURFACE_PROBES_WGSL } from './field.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { reflectionFrontWgsl } from './viewLayout.ts'
import { REFLECTION_FIELD_OVER_WGSL } from './wgsl.ts'
import { reflectionFieldLobesWgsl, reflectionWeighWgsl } from './weight.ts'

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
    `${loadOnlyTarget(traced, FRONT_TRACED_FORMAT, 'frontTraced').wgsl}
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
 let t=textureLoad(frontTraced,vec2i(position.xy));
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
 let seen=Reflected(reflectionFieldOver(probes[1],reflect(-V,N),rough),reflectionFieldCoat(P,V));
 return mat2x3f(lambertDiffuse(rgb,metal,indirectGathered(probes[0],N),ao),reflectionShare(seen,f0,rough,N,V));
}`,
  )
