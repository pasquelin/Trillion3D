import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ndcToPixel, slabPerspective } from '../../../../../math/src/wgsl/projection.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { spVectors } from './vectorsWgsl.ts'

/**
 * The meta word a pixel's history keeps beside its colour (the second word of `SCREEN_PROBE_FORMATS.history`), four fields:
 * the depth the image measured it at — the view-space linear depth, in sixteen bits of a half float —, then in four
 * bits each the amount of fast update it was left with (`ceil(amount · 15)`, so that only none is none) and the frames it
 * holds (`round(frames / longest · 15)`, the longest read in 15 at most: the setting keeps it so), and in eight bits its
 * occlusion (`round(occlusion · 255)`, one at least: no pixel lit holds none). `spMetaDepth`, `spMetaFast` and
 * `spMetaOcclusion` read it as it is, the lighting's included (`SP_META_DECODE`); `spMetaOf` writes it and `spMetaFrames` reads the
 * frames against the longest history, which the parameters hold.
 */
export const SP_META_DECODE = wgslBlock(
  'SP_META_DECODE',
  [],
  `fn spMetaDepth(word:u32)->f32{return unpack2x16float(word&0xffffu).x;}
fn spMetaFast(word:u32)->f32{return f32((word>>16u)&15u)/15.0;}
fn spMetaOcclusion(word:u32)->f32{return f32(word>>24u)/255.0;}`,
)

const SP_META_WGSL = wgslBlock(
  'SP_META_WGSL',
  [SP_META_DECODE],
  `fn spMetaOf(w:f32,frames:f32,fast:f32,occlusion:f32)->u32{
 let longest=f32(sp.counts.x);
 let encodedFrames=u32(round(saturate(frames/longest)*15.0));
 let encodedFast=u32(ceil(saturate(fast)*15.0));
 let encodedOcclusion=u32(clamp(round(occlusion*255.0),1.0,255.0));
 return (pack2x16float(vec2f(w,0.0))&0xffffu)|(encodedFast<<16u)|(encodedFrames<<20u)|(encodedOcclusion<<24u);
}
fn spMetaFrames(word:u32)->f32{return f32((word>>20u)&15u)/15.0*f32(sp.counts.x);}`,
)

/**
 * WHERE A POINT WAS IN THE LAST IMAGE, and what that image kept there (`historyIn`, at `meta`: the light's word, the meta
 * word). `spReproject` takes the surface of `pixel`, at the world point `P` of normal `N`, to where it stood in the last
 * lit image: the device position the camera's motion and its own put it at (`spMotionOf`), the depth it is expected at
 * that of `P` through the view-projection that image was drawn with (`radianceViewProj`), and names the four texels round
 * it with the weight each deserves: bilinear, and nil where the texel's own depth is not the expected one within
 * `sp.scene.w` of it times a share from a half to one and a half by `noise`, divided by the share of its normal facing the
 * eye (from a tenth to one) — the pixel there is another surface — or where its weight is under `historyMinWeight`. The
 * words of the four texels come with it. A point the image did not show, or no history at all (`SP_FLAG_TEMPORAL` down),
 * has none. `spDeviceGap` is how far, in device depth, the depth a history word kept lies from the one a point of the
 * clip position `expected` has: what the screen trace's hits are kept by.
 */
export const spHistory = (history: number, vectors: number) =>
  wgslBlock(
    `spHistory(${history}, ${vectors})`,
    [SP_META_WGSL, spVectors(vectors), ndcToPixel, slabPerspective],
    `@group(0) @binding(${history}) var historyIn:texture_2d<u32>;
const SP_HISTORY_MIN_WEIGHT:f32=${SCREEN_PROBE_CONSTANTS.historyMinWeight};
/** The four texels of the last image round a point (\`texel\` the first, then +x, +y, both), their weights and their
 *  words; \`w\`, the depth the point is expected at. */
struct SpHistory{texel:vec2i,weights:vec4f,words:array<vec2u,4>,w:f32,}
fn spReproject(pixel:vec2u,P:vec3f,N:vec3f,noise:f32)->SpHistory{
 let clip=reflectionView.radianceViewProj*vec4f(P,1.0);
 let depth=reflectionLinearDepth(clip);
 var out=SpHistory(vec2i(0),vec4f(0.0),array<vec2u,4>(),depth);
 let size=reflectionView.radiance.xy;
 if(clip.w<=0.0||!spFlag(SP_FLAG_TEMPORAL)){return out;}
 let px=ndcToPixel(spMotionOf(vec2i(pixel),P,clip.xy/clip.w).ndc,size)-vec2f(0.5);
 let base=floor(px);
 let f=px-base;
 let blend=vec4f((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
 let facing=saturate(dot(N,viewToEye(P)));
 let threshold=depth*sp.scene.w*mix(0.5,1.5,noise)/mix(0.1,1.0,facing);
 out.texel=vec2i(base);
 for(var i=0u;i<4u;i++){
  let t=out.texel+vec2i(i32(i&1u),i32(i>>1u));
  if(blend[i]>SP_HISTORY_MIN_WEIGHT&&all(t>=vec2i(0))&&all(vec2f(t)<size)){
   let word=textureLoad(historyIn,t,0).rg;
   if(abs(spMetaDepth(word.y)-depth)<threshold){out.weights[i]=blend[i];out.words[i]=word;}
  }
 }
 return out;
}
/** What the last image kept at the point's history, weighed: its frames, then its fast update; none where it has none. */
fn spHistoryKept(h:SpHistory)->vec2f{
 var words=h.words;
 var kept=vec2f(0.0);
 for(var i=0u;i<4u;i++){
  if(h.weights[i]>0.0){kept+=h.weights[i]*vec2f(spMetaFrames(words[i].y),spMetaFast(words[i].y));}
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
