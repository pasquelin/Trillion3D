import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { SHARED_EXPONENT_WGSL } from '../bounce/sharedExponentWgsl.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE } from './constants.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { reflectionWeighWgsl } from './weight.ts'

/**
 * THE UPSAMPLE, edge-aware: each full-resolution pixel of a reflecting surface reads the four history
 * texels nearest it (`upsampled`, `temporalWgsl.ts`), bilinear by its place among their centres, each
 * weighed by whether it holds the same surface (`reflectionSameSurface`: its depth and normal, which the
 * history texel carries), so that a reflection never bleeds across a silhouette or a crease. The pixel's
 * own half texel traced a pixel of its own surface in its 2×2 block, so one of the four is of the
 * pixel's surface; where none passes the test (a surface a pixel thin), the bilinear mean of the texels
 * that hold a history answers.
 *
 * `upsampleOpaque` weighs the radiance on the pixel's own reflectance, normal, roughness and lobes
 * (`reflectionShare`) — the texture detail of a surface is the pixel's, never the half grid's — into the
 * reflection target the resolve reads (`resolvedReflectionWgsl`). `upsampleFront` writes the front
 * surface's radiance where the forward fragments read it, one load (`forwardTrace`). A pixel that does not
 * reflect writes nothing, and nothing reads it.
 */
export const REFLECTION_UPSAMPLE_WGSL = wgslBlock(
  'REFLECTION_UPSAMPLE_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    reflectionWeighWgsl(true),
    SHARED_EXPONENT_WGSL,
    surfaceReflects,
    f0Of,
  ],
  `@group(0) @binding(${B.upsampleIn}) var upsampleIn:texture_2d<u32>;
@group(0) @binding(${B.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${B.target}) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(${B.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
/** The radiance the surface \`layer\` reflects at pixel \`coord\`, its point \`P\`, normal \`N\`, seen from \`V\`. */
fn upsampled(layer:u32,coord:vec2i,P:vec3f,N:vec3f,V:vec3f)->Reflected{
 let depth=reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));
 // A neighbour's centre lies within two pixels of the pixel's on each axis.
 let g=historyGather(upsampleIn,(vec2f(coord)+vec2f(0.5))*0.5-vec2f(0.5),depth,N,V,2.0);
 if(g.sharpWeight>REFLECTION_EPSILON){
  return Reflected(g.sharp.base/g.sharpWeight,g.sharp.coat/g.sharpWeight);
 }
 let n=max(g.nearWeight,1e-30);
 return Reflected(g.near.base/n,g.near.coat/n);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn upsampleOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let coord=vec2i(id.xy);
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let own=reflectingPixelAt(0u,coord,flags);
 let base=textureLoad(traceBase,coord,0);
 let share=reflectionShare(upsampled(0u,coord,own.P,own.N,own.V),f0Of(base.rgb,base.a),own.rough,own.N,own.V);
 textureStore(traceOut,coord,vec4f(share,1.0));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn upsampleFront(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let coord=vec2i(id.xy);
 if(!surfaceReflects(surfaceFlagsAt(coord))){return;}
 let own=reflectingPixelAt(1u,coord,0u);
 let traced=upsampled(1u,coord,own.P,own.N,own.V);
 textureStore(frontOut,coord,vec4u(rtPackShared(traced.base),rtPackShared(traced.coat),0u,0u));
}`,
)
