import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { HALF_FORMAT } from './halfTexture.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'

/**
 * THE TEMPORAL ACCUMULATION of a surface's half grid (`temporalOpaque`, `temporalFront`): each texel
 * blends this image's fresh radiance (`temporalIn`, the trace's) with its history (`historyIn`, the
 * last image's output), and writes the history the upsample reads and the next image blends with
 * (`historyOut`). Every texel takes a fresh ray every image: a history only ever weighs beside one.
 *
 * - REPROJECTION: the traced point `P` taken through the view-projection the last image was drawn with
 *   — the radiance pyramid's (`ReflectionView.radianceViewProj`), the one previous view of the engine —;
 *   a mirror-like lobe (its cone under a pixel over the screen march, `REFLECTION_STEP_CAP`) reprojects
 *   its reflection's virtual point instead, `hit` behind the surface along the view (`reflectionHit`), a
 *   direction where the ray met nothing near, so that a reflection keeps its own parallax.
 * - REJECTION: the four history texels around the reprojected point, bilinear, each kept as far as it
 *   held the same surface (`reflectionSameSurface`: its depth in that view and its normal, the texel
 *   carries both), the screen distance between the virtual and the surface's reprojection widening the
 *   depth test; none kept, no history. No history either on an image whose screen is not traced
 *   (`forgetReflectedImage`: the content joined).
 * - CLAMP: on an image drawn for a change (`ReflectionView.temporal.y` zero: the camera moved, a light
 *   changed, the scene did), the history is clamped to the fresh texels around it, mean ± `REFLECTION_CLAMP`
 *   standard deviations: a lamp that moved lights the history at once. On a quiet image it is not, so the
 *   picks of the 2×2 block (`traceHalf.ts`) average without bias.
 * - BLEND: the running mean of `count` images, `REFLECTION_HISTORY` at most, then an exponential mean of
 *   that window while anything moves. Once the view has been quiet for `REFLECTION_HISTORY` images, a
 *   texel whose history is full is copied as it is: a still view's reflections freeze, the same bits
 *   image after image, and the view settles (`settle.ts`). The reprojection aims at the texel's centre
 *   (the traced pixel's point moved by the pixels between them), so a still view reads its own texel.
 */
export const REFLECTION_TEMPORAL_WGSL = wgslBlock(
  'REFLECTION_TEMPORAL_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_CONE_WGSL,
    LOBE_AXIS_WGSL,
    clipToFramebuffer,
  ],
  `@group(0) @binding(${B.temporalIn}) var temporalIn:texture_2d<u32>;
@group(0) @binding(${B.historyIn}) var historyIn:texture_2d<u32>;
@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${HALF_FORMAT},write>;
/** The history of a texel whose surface lies at \`P\`, of normal \`N\`, seen from \`V\`, reprojected by \`aim\`
 *  (\`P\`, a virtual point or a direction), \`offset\` pixels from the texel's centre; its count, zero for
 *  none. The texel's centre moves as its traced point does, so a still view finds its own texel whole. */
struct TemporalHistory{radiance:Reflected,count:f32,}
fn temporalHistory(P:vec3f,N:vec3f,V:vec3f,aim:vec4f,offset:vec2f)->TemporalHistory{
 var held=TemporalHistory(Reflected(vec3f(0.0),vec3f(0.0)),0.0);
 let size=reflectionView.radiance.xy;
 let surface=reflectionView.radianceViewProj*vec4f(P,1.0);
 let aimed=reflectionView.radianceViewProj*aim;
 if(reflectionView.traced.x==0u||surface.w<=0.0||aimed.w<=0.0){return held;}
 let at=clipToFramebuffer(aimed,size).xy+offset;
 let apart=distance(at,clipToFramebuffer(surface,size).xy);
 let depth=reflectionLinearDepth(surface);
 let q=at*0.5-vec2f(0.5);
 let corner=vec2i(floor(q));
 let f=q-floor(q);
 let last=vec2i(textureDimensions(historyIn))-vec2i(1);
 var weight=0.0;
 for(var k=0u;k<4u;k++){
  let o=vec2u(k&1u,k>>1u);
  let tap=corner+vec2i(o);
  if(any(tap<vec2i(0))||any(tap>last)){continue;}
  let t=textureLoad(historyIn,tap,0);
  if(historyCount(t)==0u){continue;}
  let w=mix(1.0-f.x,f.x,f32(o.x))*mix(1.0-f.y,f.y,f32(o.y))
   *reflectionSameSurface(depth,N,V,historyDepth(t),historyNormal(t),1.0+apart);
  if(w<=0.0){continue;}
  let r=texelReflected(t);
  held.radiance.base+=w*r.base;held.radiance.coat+=w*r.coat;
  held.count+=w*f32(historyCount(t));
  weight+=w;
 }
 if(weight<REFLECTION_EPSILON){return TemporalHistory(Reflected(vec3f(0.0),vec3f(0.0)),0.0);}
 held.radiance.base/=weight;held.radiance.coat/=weight;held.count/=weight;
 return held;
}
/** The history \`h\` held within mean ± \`REFLECTION_CLAMP\` deviations of the fresh texels around \`at\`. */
fn temporalClamp(h:Reflected,at:vec2i)->Reflected{
 var mean=Reflected(vec3f(0.0),vec3f(0.0));
 var square=mean;
 var n=0.0;
 let last=vec2i(textureDimensions(temporalIn))-vec2i(1);
 for(var k=0;k<9;k++){
  let tap=clamp(at+vec2i(k%3-1,k/3-1),vec2i(0),last);
  let t=textureLoad(temporalIn,tap,0);
  if(!freshValid(t)){continue;}
  let r=texelReflected(t);
  mean.base+=r.base;mean.coat+=r.coat;
  square.base+=r.base*r.base;square.coat+=r.coat*r.coat;
  n+=1.0;
 }
 mean.base/=n;mean.coat/=n;
 let spread=Reflected(
  REFLECTION_CLAMP*sqrt(max(square.base/n-mean.base*mean.base,vec3f(0.0))),
  REFLECTION_CLAMP*sqrt(max(square.coat/n-mean.coat*mean.coat,vec3f(0.0))));
 return Reflected(clamp(h.base,mean.base-spread.base,mean.base+spread.base),
  clamp(h.coat,mean.coat-spread.coat,mean.coat+spread.coat));
}
fn temporalTexel(at:vec2i,layer:u32)->vec4u{
 let fresh=textureLoad(temporalIn,at,0);
 if(!freshValid(fresh)){return vec4u(0u);}
 let quiet=reflectionView.temporal.y;
 if(quiet>=REFLECTION_HISTORY){
  let kept=textureLoad(historyIn,at,0);
  if(historyCount(kept)>=REFLECTION_HISTORY){return kept;}
 }
 let coord=halfPixel(at,freshPick(fresh));
 let P=surfacePointAt(layer,coord);
 let normal=surfaceNormalAt(coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 let now=texelReflected(fresh);
 let hit=freshHit(fresh);
 var aim=vec4f(P,1.0);
 if(reflectionConeTangent(lobeAlpha(normal.a))*REFLECTION_STEP_CAP<1.0){
  aim=select(vec4f(P-V*hit,1.0),vec4f(-V,0.0),hit>=HALF_MAX);
 }
 let held=temporalHistory(P,N,V,aim,vec2f(at*2+vec2i(1))-vec2f(coord)-vec2f(0.5));
 let full=u32(round(held.count));
 let depth=reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));
 var history=held.radiance;
 if(quiet==0u&&full>0u){history=temporalClamp(history,at);}
 let count=min(full+1u,REFLECTION_HISTORY);
 let share=1.0/f32(count);
 let blended=Reflected(mix(history.base,now.base,share),mix(history.coat,now.coat,share));
 return historyPack(blended,depth,N,count);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn temporalOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(historyOut))){return;}
 textureStore(historyOut,id.xy,temporalTexel(vec2i(id.xy),0u));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn temporalFront(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(historyOut))){return;}
 textureStore(historyOut,id.xy,temporalTexel(vec2i(id.xy),1u));
}`,
)
