import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { reflectionFrontTracedWgsl } from './viewLayout.ts'
import { translucentReflectionWgsl } from './translucentWgsl.ts'
import { reflectionEnvironmentLobesWgsl, reflectionWeighWgsl } from './weight.ts'

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
 * a surface behind the front, an image whose trace did not answer it —, the environment through each lobe
 * (`reflectionEnvironmentOf`), only the front layer being worth a traced ray, the layers behind it seen
 * through it. No forward fragment
 * casts a ray: the scene trace is the trace's alone. With `scene` (the format the radiance cache's final maps are read in, a device that grants
 * the sampled textures for it, `grantsTranslucentReflection`) the fragment that is not the front surface reflects what the scene holds along its mirror direction
 * (`translucentReflectionWgsl`, `forwardScene`: the radiance cache, else the environment, then the last lit image); without it, the fragment stage keeps within the sixteen sampled
 * textures WebGPU guarantees and reflects the environment alone. `surfaceReflection` is the blend's, weighed on the
 * reflectance `f0` as the opaque trace's is.
 */
const forwardReflectionWgsl = (
  group: number,
  lobes: boolean,
  traced: number,
  scene?: LightAtlasFormat,
) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes}, ${traced}${scene ? `, ${scene}` : ''})`,
    [
      reflectionWeighWgsl(lobes, 'slab'),
      reflectionEnvironmentLobesWgsl(lobes),
      reflectionFrontTracedWgsl(group),
      surfaceReflects,
      FRONT_PACK_WGSL,
      ...(scene ? [translucentReflectionWgsl(group, scene)] : []),
    ],
    `${loadOnlyTarget(traced, FRONT_TRACED_FORMAT, 'frontTraced').wgsl}
const FRONT_DEPTH_THRESHOLD:u32=${FRONT_DEPTH_THRESHOLD}u;
/** Whether the depth \`z\` at pixel \`at\` is the front pass's there: the bit patterns of two depths of
 *  the view, never negative, within \`FRONT_DEPTH_THRESHOLD\` units. */
fn frontDepthMatches(at:vec2i,z:f32)->bool{
 let a=textureLoad(frontTraced,at).z;
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
 return ${scene ? 'forwardScene(P,N,V,rough,position.xy)' : 'reflectionEnvironmentOf(N,V,rough)'};
}
fn surfaceReflection(f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f,position:vec4f)->vec3f{
 if(!surfaceReflects(surfaceModel)){return vec3f(0.0);}
 return reflectionShare(forwardTrace(P,N,V,rough,position,true),f0,rough,N,V);
}`,
  )

/**
 * A forward fragment's indirect light (`forwardIndirect`, the blend's): its diffuse bounce and its reflection weighed on the reflectance
 * `f0` (`surfaceReflection`), a column each. The bounce is what the translucency volume holds at the fragment's point (`gi`:
 * `translucentGiIrradiance`, one filtered fetch, the sky light's where no volume is made); the reflection is the front's traced radiance where the
 * fragment is the front surface of its pixel, else what the scene holds along its mirror direction (`scene`) or the environment through its lobes. A fragment that `reflects` nothing (the
 * caller's `blendUnreflecting`) takes no reflection at all: the trace is not read, the column is zero.
 */
export const forwardIndirectWgsl = (
  group: number,
  lobes: boolean,
  traced: number,
  gi: WgslDecl,
  scene?: LightAtlasFormat,
) =>
  wgslBlock(
    `forwardIndirectWgsl(${group}, ${lobes}, ${traced}${scene ? `, ${scene}` : ''})`,
    [forwardReflectionWgsl(group, lobes, traced, scene), gi, lambertDiffuse],
    `fn forwardIndirect(rgb:vec3f,metal:f32,f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f,position:vec4f,ao:f32,reflects:bool)->mat2x3f{
 let colour=clothDiffuse(rgb,metal);
 let diffuse=lambertDiffuse(colour.rgb,colour.w,translucentGiIrradiance(P,N,translucentGiSingle),ao);
 var reflection=vec3f(0.0);
 if(reflects){reflection=surfaceReflection(f0,rough,N,V,P,position);}
 return mat2x3f(diffuse,reflection);
}`,
  )
