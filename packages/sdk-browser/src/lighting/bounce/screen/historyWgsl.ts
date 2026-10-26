import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ndcToPixel, slabPerspective } from '../../../../../math/src/wgsl/projection.ts'
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
 * The meta word a pixel keeps beside its light (`SCREEN_PROBE_FORMATS.meta`, which only the temporal pass and the probes' reads of the
 * last image's depths read), three fields: the depth the image measured it at — the view-space linear depth, in sixteen bits of a
 * half float —, then in four bits each the amount of fast update it was left with (`ceil(amount · 15)`, so that only none is
 * none) and the frames it holds (`round(frames / min(longest, 15) · 15)`: the code 15 is the longest, whatever it is).
 * `spMetaDepth` and `spMetaFast` read it as it is; `spMetaOf` writes it and `spMetaFrames` reads the frames against the longest
 * history, which the parameters hold.
 */
const SP_META_DECODE = wgslBlock(
  'SP_META_DECODE',
  [],
  `fn spMetaDepth(word:u32)->f32{return unpack2x16float(word&0xffffu).x;}
fn spMetaFast(word:u32)->f32{return f32((word>>16u)&15u)/15.0;}`,
)

const SP_META_WGSL = wgslBlock(
  'SP_META_WGSL',
  [SP_META_DECODE],
  `const SP_FRAME_CODES:f32=${SCREEN_PROBE_CONSTANTS.maxFramesCoded}.0;
fn spMetaOf(w:f32,frames:f32,fast:f32)->u32{
 let encodedFrames=u32(round(saturate(frames/min(f32(sp.counts.x),SP_FRAME_CODES))*SP_FRAME_CODES));
 let encodedFast=u32(ceil(saturate(fast)*15.0));
 return (pack2x16float(vec2f(w,0.0))&0xffffu)|(encodedFast<<16u)|(encodedFrames<<20u);
}
fn spMetaFrames(word:u32)->f32{
 let code=(word>>20u)&15u;
 let longest=f32(sp.counts.x);
 return select(f32(code)/SP_FRAME_CODES*min(longest,SP_FRAME_CODES),longest,f32(code)==SP_FRAME_CODES);
}`,
)

/**
 * WHERE A POINT WAS IN THE LAST IMAGE, and what that image kept there (`metaIn`, at `meta`: the meta word of the last
 * image's pixels). `spReproject` takes the surface of `pixel`, at the world point `P` of normal `N`, to where it stood in the last
 * lit image: the device position the camera's motion and its own put it at (`spMotionOf`), the depth it is expected at
 * that of `P` through the view-projection that image was drawn with (`radianceViewProj`), and names the four texels round
 * it with the weight each deserves: bilinear, and nil where the texel's own depth is not the expected one within
 * `sp.scene.y` of it times a share from a half to one and a half by `noise`, divided by the share of its normal facing the
 * eye (from a tenth to one) — the pixel there is another surface — or where its weight is under `historyMinWeight`. The
 * meta words of the four texels come with it. A point the image did not show, or no history at all (`SP_FLAG_TEMPORAL` down),
 * has none. `spDeviceGap` is how far, in device depth, the depth a meta word kept lies from the one a point of the
 * clip position `expected` has: what the screen trace's hits are kept by.
 */
export const spHistory = (meta: number, vectors: number) =>
  wgslBlock(
    `spHistory(${meta}, ${vectors})`,
    [SP_META_WGSL, spVectors(vectors), ndcToPixel, slabPerspective],
    `@group(0) @binding(${meta}) var metaIn:texture_2d<u32>;
const SP_HISTORY_MIN_WEIGHT:f32=${SCREEN_PROBE_CONSTANTS.historyMinWeight};
/** The four texels of the last image round a point (\`texel\` the first, then +x, +y, both), their weights and their
 *  meta words; \`w\`, the depth the point is expected at. */
struct SpHistory{texel:vec2i,weights:vec4f,metas:array<u32,4>,w:f32,}
fn spReproject(pixel:vec2u,P:vec3f,N:vec3f,noise:f32)->SpHistory{
 let clip=reflectionView.radianceViewProj*vec4f(P,1.0);
 let depth=reflectionLinearDepth(clip);
 var out=SpHistory(vec2i(0),vec4f(0.0),array<u32,4>(),depth);
 let size=reflectionView.radiance.xy;
 if(clip.w<=0.0||!spFlag(SP_FLAG_TEMPORAL)){return out;}
 let px=ndcToPixel(spMotionOf(vec2i(pixel),P,clip.xy/clip.w).ndc,size)-vec2f(0.5);
 let base=floor(px);
 let f=px-base;
 let blend=vec4f((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
 let facing=saturate(dot(N,viewToEye(P)));
 let threshold=depth*sp.scene.y*mix(0.5,1.5,noise)/mix(0.1,1.0,facing);
 out.texel=vec2i(base);
 for(var i=0u;i<4u;i++){
  let t=out.texel+vec2i(i32(i&1u),i32(i>>1u));
  if(blend[i]>SP_HISTORY_MIN_WEIGHT&&all(t>=vec2i(0))&&all(vec2f(t)<size)){
   let word=textureLoad(metaIn,t,0).r;
   if(abs(spMetaDepth(word)-depth)<threshold){out.weights[i]=blend[i];out.metas[i]=word;}
  }
 }
 return out;
}
/** What the last image kept at the point's history, weighed: its frames, then its fast update; none where it has none. */
fn spHistoryKept(h:SpHistory)->vec2f{
 var metas=h.metas;
 var kept=vec2f(0.0);
 for(var i=0u;i<4u;i++){
  if(h.weights[i]>0.0){kept+=h.weights[i]*vec2f(spMetaFrames(metas[i]),spMetaFast(metas[i]));}
 }
 return kept/max(dot(h.weights,vec4f(1.0)),1e-5);
}
fn spHistoryFrames(h:SpHistory)->f32{return spHistoryKept(h).x;}
fn spDeviceGap(word:u32,expected:vec4f)->f32{
 let linear=reflectionLinearDepth(expected);
 let kept=spMetaDepth(word);
 if(!slabPerspective(reflectionView.slab)){return abs(kept-linear);}
 return abs((expected.z/expected.w-reflectionView.slab.y)*(linear/max(kept,1e-6)-1.0));
}`,
  )
