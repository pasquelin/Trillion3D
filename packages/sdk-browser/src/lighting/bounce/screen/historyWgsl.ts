import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ndcToPixel } from '../../../../../math/src/wgsl/projection.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { spVectors } from './vectorsWgsl.ts'

/**
 * THE BENT NORMAL as the screen probes keep it (`spBentPack`, `spBentUnpack`): the direction of the open sky a pixel sees times
 * the amount of it, a vector of at most unit length, each component held in [-1, 1] and coded in a word in 11, 11 and 10 bits.
 * The occlusion pass writes it, the temporal pass blends it with the history's (the direction and the amount apart:
 * `spBentUnpack` gives the unit direction in `xyz` and the amount in `w`), the lighting reads it (`SCREEN_INDIRECT_WGSL`). A word of
 * zero is none: the pass never writes one for a lit pixel, whose amount is a thirtieth at least.
 */
export const SP_BENT_WGSL = wgslBlock(
  'SP_BENT_WGSL',
  [],
  `fn spBentPack(v:vec3f)->u32{
 let q=saturate(v*0.5+vec3f(0.5));
 return (u32(q.x*2047.0+0.5)<<21u)|(u32(q.y*2047.0+0.5)<<10u)|u32(q.z*1023.0+0.5);
}
fn spBentUnpack(word:u32)->vec4f{
 let v=vec3f(f32(word>>21u)/2047.0,f32((word>>10u)&2047u)/2047.0,f32(word&1023u)/1023.0)*2.0-vec3f(1.0);
 let amount=length(v);
 return vec4f(v/max(amount,0.0001),amount);
}`,
)

/**
 * The surface a pixel keeps beside its light (`SCREEN_PROBE_FORMATS.shading`), read by the temporal pass and the probes' reads
 * of the last image, in two words. The first is a normal and the pixel's kind in the 10-10-10-2 bits of a normalised texel: the normal as
 * `n · ½ + ½`, 10 bits an axis (`spShadingPack`, `spShadingNormal`), then in the two bits above whether the pixel has backface diffuse light
 * (`spShadingFoliage`); the history is kept only where the kind agrees with the pixel's. The second is the frames the pixel holds and its amount
 * of fast update, in one byte: the amount in the high four bits (`ceil(amount · 15)`, so that only none is none) and the frames in the low four
 * (`round(frames / min(longest, 15) · 15)`: the code 15 is the longest, whatever it is). `spFramesOf` writes the byte; `spFramesHeld` and
 * `spFastHeld` read it, the frames against the longest history, which the parameters hold. The pixel's device depth is another texture
 * (`spHistoryDepth`).
 */
const SP_SHADING_WGSL = wgslBlock(
  'SP_SHADING_WGSL',
  [],
  `const SP_FRAME_CODES:f32=${SCREEN_PROBE_CONSTANTS.maxFramesCoded}.0;
fn spShadingPack(N:vec3f,foliage:bool)->u32{
 let q=saturate(N*0.5+vec3f(0.5))*1023.0+vec3f(0.5);
 return u32(q.x)|(u32(q.y)<<10u)|(u32(q.z)<<20u)|(select(0u,1u,foliage)<<30u);
}
fn spShadingNormal(word:u32)->vec3f{
 return vec3f(f32(word&1023u),f32((word>>10u)&1023u),f32((word>>20u)&1023u))/1023.0*2.0-vec3f(1.0);
}
fn spShadingFoliage(word:u32)->bool{return ((word>>30u)&1u)!=0u;}
fn spFramesOf(frames:f32,fast:f32)->u32{
 let encodedFrames=u32(round(saturate(frames/min(f32(sp.counts.x),SP_FRAME_CODES))*SP_FRAME_CODES));
 let encodedFast=u32(ceil(saturate(fast)*15.0));
 return encodedFrames|(encodedFast<<4u);
}
fn spFastHeld(code:u32)->f32{return f32((code>>4u)&15u)/15.0;}
fn spFramesHeld(code:u32)->f32{
 let held=code&15u;
 let longest=f32(sp.counts.x);
 return select(f32(held)/SP_FRAME_CODES*min(longest,SP_FRAME_CODES),longest,f32(held)==SP_FRAME_CODES);
}
`,
)

/**
 * THE LAST IMAGE'S PIXELS, at `shading` of group 0 (`shadingIn`, `SCREEN_PROBE_FORMATS.shading`: what the pixel kept, `SP_SHADING_WGSL`).
 */
const spHistoryShading = (shading: number) =>
  wgslBlock(
    `spHistoryShading(${shading})`,
    [SP_SHADING_WGSL],
    `@group(0) @binding(${shading}) var shadingIn:texture_2d<u32>;`,
  )

/**
 * THE LAST IMAGE'S DEPTHS, at `depth` of group 0 (`depthIn`, `SCREEN_PROBE_FORMATS.keptDepth`): the device depth the pixel `t` was found at, as the depth buffer held
 * it, zero where it showed no surface (`spKeptDepth`). `spDeviceGap` is how far, in device depth, the depth `kept` lies from the one a point of the clip position `expected`
 * has: what the screen trace's hits are kept by; a texel that kept no surface matches nothing.
 */
export const spHistoryDepth = (depth: number) =>
  wgslBlock(
    `spHistoryDepth(${depth})`,
    [],
    `@group(0) @binding(${depth}) var depthIn:texture_2d<f32>;
fn spKeptDepth(t:vec2i)->f32{return textureLoad(depthIn,t,0).r;}
fn spDeviceGap(kept:f32,expected:vec4f)->f32{
 return select(1e30,abs(kept-expected.z/expected.w),kept>0.0);
}`,
  )

/**
 * WHERE A POINT WAS IN THE LAST IMAGE, and what that image kept there (`depthIn`, at `depth`: the pixels' depths; `shadingIn`, at `shading`: their normals and frames,
 * `SP_SHADING_WGSL`). `spReproject` takes the surface of `pixel`, at the world point `P` of normal `N`, that has backface diffuse light
 * where `foliage`, to where it stood in the last lit image: the device
 * position the camera's motion and its own put it at (`spMotionOf`), the depth it is expected at that of `P` through the view-projection
 * that image was drawn with (`radianceViewProj`), turned from device depth to the view's depth as the depths the image kept are, and
 * names the four texels round it with the weight each deserves: bilinear, and nil where the texel's own depth is not the expected one within
 * the threshold — `sp.scene.y`, `sp.scene.w` for a pixel with backface diffuse light — of it times a share from a half to one and a half by `noise`,
 * divided by the share of its normal facing the eye (from a tenth to one) — the pixel there is another surface —, where the texel has backface
 * diffuse light and the pixel does not, or the other way round, where the setting asks it (`SP_FLAG_REJECT_NORMAL`) where its normal lies
 * further from `N` than the angle whose cosine is `sp.scene.z`, or where its weight is under `historyMinWeight`. The frames codes of the four
 * texels come with it. A point the image did not show, or no history at all (`SP_FLAG_TEMPORAL` down), has none.
 */
export const spHistory = (shading: number, depth: number, vectors: number) =>
  wgslBlock(
    `spHistory(${shading}, ${depth}, ${vectors})`,
    [spHistoryShading(shading), spHistoryDepth(depth), spVectors(vectors), ndcToPixel],
    `const SP_HISTORY_MIN_WEIGHT:f32=${SCREEN_PROBE_CONSTANTS.historyMinWeight};
/** The four texels of the last image round a point (\`texel\` the first, then +x, +y, both), their weights and their
 *  frames codes. */
struct SpHistory{texel:vec2i,weights:vec4f,codes:array<u32,4>,}
fn spReproject(pixel:vec2u,P:vec3f,N:vec3f,foliage:bool,noise:f32)->SpHistory{
 let clip=reflectionView.radianceViewProj*vec4f(P,1.0);
 var out=SpHistory(vec2i(0),vec4f(0.0),array<u32,4>());
 let size=reflectionView.radiance.xy;
 if(clip.w<=0.0||!spFlag(SP_FLAG_TEMPORAL)){return out;}
 let motion=spMotionOf(vec2i(pixel),P,clip.xy/clip.w);
 // The depth the last image kept the point at: where it stood then (\`before\`, a moving surface's last place), its device depth
 // turned to the view's, as the depths the image kept are. A surface that did not move by itself stood where it is.
 let stood=spStoodClip(motion,P,clip);
 if(stood.w<=0.0){return out;}
 let expected=reflectionLinearOfDevice(stood.z/stood.w);
 let px=ndcToPixel(motion.ndc,size)-vec2f(0.5);
 let base=floor(px);
 let f=px-base;
 let blend=vec4f((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
 let facing=saturate(dot(N,viewToEye(P)));
 let threshold=expected*select(sp.scene.y,sp.scene.w,foliage)*mix(0.5,1.5,noise)/mix(0.1,1.0,facing);
 out.texel=vec2i(base);
 for(var i=0u;i<4u;i++){
  let t=out.texel+vec2i(i32(i&1u),i32(i>>1u));
  if(blend[i]>SP_HISTORY_MIN_WEIGHT&&all(t>=vec2i(0))&&all(vec2f(t)<size)){
   let device=spKeptDepth(t);
   // A device depth of zero is a texel that kept no surface, whatever depth the view's far end gives it.
   if(device>0.0&&abs(reflectionLinearOfDevice(device)-expected)<threshold){
    let kept=textureLoad(shadingIn,t,0);
    if((!spFlag(SP_FLAG_REJECT_NORMAL)||dot(spShadingNormal(kept.x),N)>=sp.scene.z)&&spShadingFoliage(kept.x)==foliage){
     out.weights[i]=blend[i];
     out.codes[i]=kept.y;
    }
   }
  }
 }
 return out;
}
/** What the last image kept at the point's history, weighed: its frames, then its fast update; none where it has none. */
fn spHistoryKept(h:SpHistory)->vec2f{
 var codes=h.codes;
 var kept=vec2f(0.0);
 for(var i=0u;i<4u;i++){
  if(h.weights[i]>0.0){kept+=h.weights[i]*vec2f(spFramesHeld(codes[i]),spFastHeld(codes[i]));}
 }
 return kept/max(dot(h.weights,vec4f(1.0)),1e-5);
}
fn spHistoryFrames(h:SpHistory)->f32{return spHistoryKept(h).x;}`,
  )
