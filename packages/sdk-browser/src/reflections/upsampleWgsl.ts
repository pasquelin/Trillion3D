import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { REFLECTION_TRACE_BINDINGS as B, TRACE_SCENE_BINDINGS } from './halfBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { REFLECTION_GROUP } from './viewLayout.ts'
import { reflectionShareWgsl, reflectionWeighWgsl } from './weight.ts'

/**
 * THE UPSAMPLE, edge-aware and adaptive: each full-resolution pixel of a reflecting surface reads the
 * four history texels nearest it (`reflectedAt`, `temporalWgsl.ts`), bilinear by its place among their
 * centres, each weighed by whether it holds the same surface (`reflectionSameSurface`: its depth and
 * normal, which the history texel carries), so that a reflection never bleeds across a silhouette or
 * a crease; where none passes the test (a surface a pixel thin), the bilinear mean of the texels that
 * hold a history answers.
 *
 * ONE RULE OF RESOLUTION, every lobe alike: where the texels of its own surface disagree — their
 * radiance apart by more than `REFLECTION_EDGE_CONTRAST` in a perceptual space (`reflectionPerceived`),
 * a reflected edge the half grid would spread over two more pixels —, the pixel traces its own sample of
 * its lobes, at full resolution, held within those texels' range (a mirror's edge lies between them; a
 * glossy lobe's lone sample is no firefly there). Elsewhere the half grid answers. A mirror's reflected
 * silhouette is as sharp as the pixel (`sphere-staircase.gpu.ts`); a smooth reflection, the most of a
 * floor, costs no ray of its own.
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
    reflectionShareWgsl(REFLECTION_GROUP, true, TRACE_SCENE_BINDINGS),
    reflectionWeighWgsl(true),
    FRONT_PACK_WGSL,
    surfaceReflects,
    f0Of,
  ],
  `@group(0) @binding(${B.upsampleIn}) var upsampleIn:texture_2d<u32>;
@group(0) @binding(${B.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${B.target}) var reflectionOut:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(${B.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
/** What the pixel \`own\` of the surface \`layer\` at \`coord\` reflects: the half grid's answer, or its own
 *  sample where the texels around it disagree. */
fn reflectedAt(layer:u32,coord:vec2i,own:ReflectingPixel)->Reflected{
 let depth=surfaceLinearDepth(own.P);
 // A neighbour's centre lies within two pixels of the pixel's on each axis.
 let g=historyGatherNear(upsampleIn,halfPoint(vec2f(coord)+vec2f(0.5)),depth,own.N,own.V,2.0);
 if(!(g.sharpWeight>REFLECTION_EPSILON)){
  let n=max(g.nearWeight,REFLECTION_FLOOR);
  return Reflected(g.near.base/n,g.near.coat/n);
 }
 let apart=max(reflectionPerceived(g.high.base)-reflectionPerceived(g.low.base),
  reflectionPerceived(g.high.coat)-reflectionPerceived(g.low.coat));
 if(max(apart.x,max(apart.y,apart.z))>REFLECTION_EDGE_CONTRAST){
  // @cut edge -> Reflected(g.low.base,g.high.coat) keep: ;
  let traced=reflectionTrace(own.P,own.N,own.V,own.rough,reflectionSampleAt(vec2u(coord),layer+2u));
  return reflectionClamped(traced,ReflectedBounds(g.low,g.high));
 }
 return Reflected(g.sharp.base/g.sharpWeight,g.sharp.coat/g.sharpWeight);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn upsampleOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let coord=vec2i(id.xy);
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let own=reflectingPixelAt(0u,coord,flags);
 let base=textureLoad(traceBase,coord,0);
 let share=reflectionShare(reflectedAt(0u,coord,own),f0Of(base.rgb,base.a),own.rough,own.N,own.V);
 textureStore(reflectionOut,coord,vec4f(share,1.0));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn upsampleFront(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let coord=vec2i(id.xy);
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let traced=reflectedAt(1u,coord,reflectingPixelAt(1u,coord,flags));
 textureStore(frontOut,coord,vec4u(frontPack(traced.base),frontPack(traced.coat),0u,0u));
}`,
)
