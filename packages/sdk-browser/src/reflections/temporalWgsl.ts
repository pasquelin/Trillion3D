import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { reflectionWeighWgsl } from './weight.ts'

/**
 * THE TEMPORAL ACCUMULATION of a surface's grid, a pixel a thread (`temporalOpaque`, `temporalFront`):
 * each pixel blends this image's fresh radiance (`temporalIn`, the spatial reuse's) with its history
 * (`historyIn`, the last image's), writes the history the next image blends with (`historyOut`), and
 * its surface's answer: the opaque one weighs it on the pixel's own reflectance, normal, roughness and
 * lobes (`reflectionShare`) — a surface's texture detail is the pixel's — into the reflection target the
 * resolve reads; the front one writes it where the forward fragments read it, one load (`forwardTrace`).
 * Every pixel takes a fresh ray every image: a history only ever weighs beside one.
 *
 * - REPROJECTION: the pixel's point `P` taken through the view-projection the last image was drawn
 *   with — the radiance pyramid's (`ReflectionView.radianceViewProj`), the one previous view of the
 *   engine —: a reflection as wide as its lobe follows its surface; a mirror's, sharp, changes at
 *   once where its surface moves, and the clamp below lets the fresh ray answer there.
 * - REJECTION: the four history texels around the reprojected point, bilinear, each kept as far as it
 *   held the same surface (`reflectionSameSurface`: its depth in that view and its normal, the texel
 *   carries both); none kept, no history. No history either on an image whose screen is not traced
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
 *   one colour — the window's length alone differs, which changes the noise, never the mean. A still
 *   view's quiet images restart it, each at the turn of its rank (`stageReflectionImage`), and let it
 *   grow to `REFLECTION_STILL`: once the view has been quiet for that many images, every pixel holds the
 *   mean of those images' samples alone, and is copied as it is from the next on
 *   (`ReflectionView.temporal.y` past `REFLECTION_STILL`): a still view's reflections freeze, the same
 *   bits image after image, the same whatever was drawn before them, and the view settles
 *   (`settle.ts`).
 */
export const REFLECTION_TEMPORAL_WGSL = wgslBlock(
  'REFLECTION_TEMPORAL_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    reflectionWeighWgsl(true),
    FRONT_PACK_WGSL,
    surfaceReflects,
    f0Of,
    clipToFramebuffer,
  ],
  `@group(0) @binding(${B.temporalIn}) var temporalIn:texture_2d<u32>;
@group(0) @binding(${B.historyIn}) var historyIn:texture_2d<u32>;
@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${B.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${B.target}) var reflectionOut:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(${B.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
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
/** The history texel of pixel \`at\`, its surface \`own\`: this image's fresh radiance blended in. */
fn temporalTexel(at:vec2i,own:ReflectingPixel)->vec4u{
 let fresh=textureLoad(temporalIn,at,0);
 if(!freshValid(fresh)){return vec4u(0u);}
 let quiet=reflectionView.temporal.y;
 if(quiet>REFLECTION_STILL){return textureLoad(historyIn,at,0);}
 let now=texelReflected(fresh);
 let held=temporalHistory(own.P,own.N,own.V);
 let full=u32(round(held.count));
 var history=held.radiance;
 if(reflectionView.temporal.z!=0u&&full>0u){history=reflectionClamped(history,reflectionBounds(temporalIn,at));}
 let count=min(full+1u,select(REFLECTION_HISTORY,REFLECTION_STILL,quiet>0u));
 let share=1.0/f32(count);
 let blended=Reflected(mix(history.base,now.base,share),mix(history.coat,now.coat,share));
 return historyPack(blended,surfaceLinearDepth(own.P),own.N,count);
}
/** The pixel of \`id\` on the surface \`layer\`: its history written, and itself where it reflects. */
struct TemporalPixel{coord:vec2i,own:ReflectingPixel,texel:vec4u,reflects:bool,}
fn temporalPixel(id:vec2u,layer:u32)->TemporalPixel{
 let coord=vec2i(id);
 let flags=surfaceFlagsAt(coord);
 let own=reflectingPixelAt(layer,coord,flags);
 let texel=select(vec4u(0u),temporalTexel(coord,own),surfaceReflects(flags));
 textureStore(historyOut,coord,texel);
 return TemporalPixel(coord,own,texel,historyCount(texel)>0u&&all(vec2f(id)<view.viewport.xy));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn temporalOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(historyOut))){return;}
 let p=temporalPixel(id.xy,0u);
 if(!p.reflects){return;}
 let base=textureLoad(traceBase,p.coord,0);
 let share=reflectionShare(texelReflected(p.texel),f0Of(base.rgb,base.a),p.own.rough,p.own.N,p.own.V);
 textureStore(reflectionOut,p.coord,vec4f(share,1.0));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn temporalFront(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(historyOut))){return;}
 let p=temporalPixel(id.xy,1u);
 if(!p.reflects){return;}
 let r=texelReflected(p.texel);
 textureStore(frontOut,p.coord,vec4u(frontPack(r.base),frontPack(r.coat),0u,0u));
}`,
)
