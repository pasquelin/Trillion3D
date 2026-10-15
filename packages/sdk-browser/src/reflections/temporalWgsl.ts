import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { HALF_FORMAT } from './halfTexture.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_LAYER_WGSL, REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'

/**
 * THE TEMPORAL ACCUMULATION of a surface's half grid (`temporalSurface`): each texel
 * blends this image's fresh radiance (`temporalIn`, the spatial reuse's) with its history (`historyIn`, the
 * last image's output), and writes the history the upsample reads and the next image blends with
 * (`historyOut`). Every texel takes a fresh ray every image: a history only ever weighs beside one.
 *
 * - REPROJECTION: the traced point `P` taken through the view-projection the last image was drawn with
 *   — the radiance pyramid's (`ReflectionView.radianceViewProj`), the one previous view of the engine —:
 *   the half grid holds the sampled lobes alone, whose reflection is as wide as its lobe and follows its
 *   surface (a mirror's is its pixel's own, traced whole every image, `upsampleWgsl.ts`).
 * - REJECTION: the four history texels around the reprojected point, bilinear, each kept as far as it
 *   held the same surface (`reflectionSameSurface`: its depth in that view and its normal, the texel
 *   carries both), the pixels between the traced one and the texel's centre widening the depth test;
 *   none kept, no history. No history either on an image whose screen is not traced
 *   (`forgetReflectedImage`: the content joined), nor on a still view's first quiet image
 *   (`ReflectionView.temporal.y` one): a still view's history is its own images' alone.
 * - CLAMP: on an image drawn for a move (`ReflectionView.temporal.z`: the camera moved, a light changed,
 *   a body of the scene moved or deformed, `RadianceSettle.move`), the history is held to the fresh
 *   texels around it (`reflectionBounds`, the rule each fresh sample is held by): a lamp that moved
 *   lights the history at once. A history that was right lies within them, as its samples did, and is
 *   kept: the clamp removes the stale, not the mean. On any other image it is not clamped.
 * - BLEND: the running mean of `count` images, `REFLECTION_HISTORY` at most, then an exponential mean of
 *   that window while anything changes: a plain mean of fresh samples each already held to its
 *   neighbourhood (`spatialWgsl.ts`), the same samples on a moving and a still image, so both converge to
 *   one colour — the window's length alone differs, which changes the noise, never the mean. A still view's quiet images restart it, each at the turn of its
 *   rank (`stageReflectionImage`), and let it grow to `REFLECTION_STILL`: once the view has been quiet
 *   for that many images, every texel holds the mean of those images' samples alone, and is copied as
 *   it is from the next on (`ReflectionView.temporal.y` past `REFLECTION_STILL`): a still view's
 *   reflections freeze, the same bits image after image, the same whatever was drawn before them, and
 *   the view settles (`settle.ts`). The reprojection aims at the texel's centre (the traced pixel's
 *   point moved by the pixels between them), so a still view reads its own texel.
 */
export const REFLECTION_TEMPORAL_WGSL = wgslBlock(
  'REFLECTION_TEMPORAL_WGSL',
  [REFLECTION_LAYER_WGSL, REFLECTION_SURFACES_WGSL, REFLECTION_TEXEL_WGSL, clipToFramebuffer],
  `@group(0) @binding(${B.temporalIn}) var temporalIn:texture_2d<u32>;
@group(0) @binding(${B.historyIn}) var historyIn:texture_2d<u32>;
@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${HALF_FORMAT},write>;
/** The history of a texel whose surface lies at \`P\`, of normal \`N\`, seen from \`V\`, \`offset\` pixels
 *  from the texel's centre; its count, zero for none — on an untraced screen and on a still view's
 *  first quiet image. The texel's centre moves as its traced point does, so a still view finds its own
 *  texel whole. */
struct TemporalHistory{radiance:Reflected,count:f32,}
fn temporalHistory(P:vec3f,N:vec3f,V:vec3f,offset:vec2f)->TemporalHistory{
 var held=TemporalHistory(Reflected(vec3f(0.0),vec3f(0.0)),0.0);
 let surface=reflectionView.radianceViewProj*vec4f(P,1.0);
 let restart=reflectionView.traced.x==0u||reflectionView.temporal.y==1u;
 if(restart||surface.w<=0.0){return held;}
 let at=clipToFramebuffer(surface,reflectionView.radiance.xy).xy+offset;
 let g=historyGather(historyIn,halfPoint(at),reflectionLinearDepth(surface),N,V,1.0+length(offset));
 if(g.sharpWeight<REFLECTION_EPSILON){return held;}
 return TemporalHistory(
  Reflected(g.sharp.base/g.sharpWeight,g.sharp.coat/g.sharpWeight),g.count/g.sharpWeight);
}
fn temporalTexel(at:vec2i,layer:u32)->vec4u{
 let fresh=textureLoad(temporalIn,at,0);
 if(!freshValid(fresh)){return vec4u(0u);}
 let quiet=reflectionView.temporal.y;
 if(quiet>REFLECTION_STILL){return textureLoad(historyIn,at,0);}
 let coord=halfPixel(at,freshPick(fresh));
 let own=reflectingPixelAt(layer,coord,0u);
 let P=own.P;let N=own.N;let V=own.V;
 let now=texelReflected(fresh);
 let held=temporalHistory(P,N,V,halfCentre(at)-vec2f(coord)-vec2f(0.5));
 let full=u32(round(held.count));
 let depth=surfaceLinearDepth(P);
 var history=held.radiance;
 if(reflectionView.temporal.z!=0u&&full>0u){history=reflectionClamped(history,reflectionBounds(temporalIn,at));}
 let count=min(full+1u,select(REFLECTION_HISTORY,REFLECTION_STILL,quiet>0u));
 let share=1.0/f32(count);
 let blended=Reflected(mix(history.base,now.base,share),mix(history.coat,now.coat,share));
 return historyPack(blended,depth,N,count);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn temporalSurface(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(historyOut))){return;}
 textureStore(historyOut,id.xy,temporalTexel(vec2i(id.xy),REFLECTION_LAYER));
}`,
)
