import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'

/**
 * THE TEMPORAL ACCUMULATION of a surface's grid, a pixel a thread (`temporalSurface`): each pixel
 * blends this image's fresh radiance (`temporalIn`, the spatial reuse's) with its history (`historyIn`,
 * the last image's) and writes the history the next image blends with and the last pass reads
 * (`historyOut`, `bilateralWgsl.ts`). Every pixel takes a fresh ray every image: a history only ever
 * weighs beside one. One rule for every pixel, on every image:
 *
 * - REPROJECTION: the pixel's point `P` taken through the view-projection the last image was drawn
 *   with — the radiance pyramid's (`ReflectionView.radianceViewProj`), the one previous view of the
 *   engine.
 * - REJECTION: the four history texels around the reprojected point, bilinear, each kept as far as it
 *   held the same surface (`reflectionSameSurface`: its depth in that view and its normal, the texel
 *   carries both); none kept, no history. No history either on an image whose screen is not traced
 *   (`forgetReflectedImage`: the content joined), nor on a still view's first quiet image
 *   (`ReflectionView.temporal.y` one): a still view's history is its own images' alone.
 * - CLAMP: the history, in the denoiser's space (`reflectionDenoised`), held to the fresh texels around
 *   the pixel (`reflectionBounds`); the farther the clamp moved it, against the window's width, the
 *   fewer images it counts for — at worst a quarter of its count, plus one: a lamp that moved lights the
 *   history at once, a history that was right is kept whole.
 * - BLEND: the running mean of `count` images in the denoiser's space, `REFLECTION_HISTORY` at most while
 *   anything changes, then an exponential mean of that window. A still view's quiet images restart it,
 *   each at the turn of its rank (`stageReflectionImage`), and let it grow to `REFLECTION_STILL`: once
 *   the view has been quiet for that many images, every pixel holds the mean of those images' samples,
 *   and is copied as it is from the next on (`ReflectionView.temporal.y` past `REFLECTION_STILL`): a
 *   still view's reflections freeze, the same bits image after image, and the view settles
 *   (`settle.ts`).
 */
export const REFLECTION_TEMPORAL_WGSL = wgslBlock(
  'REFLECTION_TEMPORAL_WGSL',
  [
    REFLECTION_LAYER_WGSL,
    REFLECTION_TILES_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    surfaceReflects,
    clipToFramebuffer,
  ],
  `@group(0) @binding(${B.temporalIn}) var temporalIn:texture_2d<u32>;
@group(0) @binding(${B.historyIn}) var historyIn:texture_2d<u32>;
@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
/** The history of a pixel whose surface lies at \`P\`, of normal \`N\`, seen from \`V\`; its count, zero
 *  for none — on an untraced screen and on a still view's first quiet image. */
struct TemporalHistory{radiance:Reflected,count:f32,}
fn temporalHistory(P:vec3f,N:vec3f,V:vec3f)->TemporalHistory{
 var held=TemporalHistory(Reflected(vec3f(0.0),vec3f(0.0)),0.0);
 let surface=reflectionView.radianceViewProj*vec4f(P,1.0);
 let restart=reflectionView.traced.x==0u||reflectionView.temporal.y==1u;
 if(restart||surface.w<=0.0){return held;}
 let at=clipToFramebuffer(surface,reflectionView.radiance.xy).xy-vec2f(0.5);
 let g=historyGather(historyIn,at,reflectionLinearDepth(surface),N,V,1.0);
 if(g.weight<REFLECTION_EPSILON){return held;}
 return TemporalHistory(Reflected(g.radiance.base/g.weight,g.radiance.coat/g.weight),g.count/g.weight);
}
/** How far the clamp moved \`h\` to \`c\`, against the window's half width: 0 kept, 1 or more moved
 *  across the whole window. */
fn temporalMoved(h:Reflected,c:Reflected,b:ReflectedBounds)->f32{
 let spread=max(max((b.high.base-b.low.base)*0.5,(b.high.coat-b.low.coat)*0.5),vec3f(REFLECTION_EPSILON));
 let moved=max(abs(c.base-h.base),abs(c.coat-h.coat))/spread;
 return max(moved.x,max(moved.y,moved.z));
}
/** The history texel of pixel \`at\` on the surface \`layer\`: this image's fresh radiance blended in. */
fn temporalTexel(at:vec2i,layer:u32)->vec4u{
 let fresh=textureLoad(temporalIn,at,0);
 if(!freshValid(fresh)||!surfaceReflects(surfaceFlagsAt(at))){return vec4u(0u);}
 let quiet=reflectionView.temporal.y;
 if(quiet>REFLECTION_STILL){return textureLoad(historyIn,at,0);}
 let own=reflectingPixelAt(layer,at,0u);
 let now=reflectionDenoised(texelReflected(fresh));
 let held=temporalHistory(own.P,own.N,own.V);
 let history=reflectionDenoised(held.radiance);
 let bounds=reflectionBounds(temporalIn,at);
 let clamped=reflectionClamped(history,bounds);
 let trust=0.75*clamp(1.0-temporalMoved(history,clamped,bounds),0.0,1.0)+0.25;
 let most=f32(select(REFLECTION_HISTORY,REFLECTION_STILL,quiet>0u));
 let count=min(held.count*trust+1.0,most);
 let share=1.0/count;
 let blended=Reflected(mix(clamped.base,now.base,share),mix(clamped.coat,now.coat,share));
 return historyPack(reflectionLinear(blended),surfaceLinearDepth(own.P),own.N,u32(round(count)));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn temporalSurface(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u){
 let id=reflectionTilePixel(tile,local);
 if(any(id>=textureDimensions(historyOut))){return;}
 textureStore(historyOut,id,temporalTexel(vec2i(id),REFLECTION_LAYER));
}`,
)
