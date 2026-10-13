import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * THE RUN-TIME PROXY'S ANSWER, KEPT FROM IMAGE TO IMAGE: text of the program that casts its rays
 * (`runtimeTraceWgsl.ts`), after `rtRadiance`. What a pixel last got from its ray lives in the store
 * (`runtimeLayout.ts`) under the stamp of the epoch (`follow`) it was cast in, so that a frame that spends its budget
 * (`FRAME_WORK`) leaves the pixels after it their last answer, and the next frames — the trace starts where the last
 * one's budget ended — answer them.
 *
 * \`rtAnswer\`, within the frame's budget and from the store: a ray is cast while the frame has spent under
 * \`RT_FRAME_WORK\` — one a frame at \`RT_WORK\` at most, and the trace starts at another tile each image
 * (the list's \`offset\`) —, its work added to the frame's, its answer kept for its pixel under the epoch's stamp.
 * An answer of this epoch is the answer: no ray is cast again for it, whatever budget is left. A ray the budget
 * leaves out answers what its pixel last got, and is counted as left when that answer is older than the epoch: the view
 * settles (\`settle.ts\`) when none is. A second call for a pixel — the clear coat's lobe — is one ray, kept nowhere.
 * No placement wearing a proxy, no ray: nothing is read or written.
 *
 * A lobe is answered along its centre, one ray. The mean over its directions, which a rough lobe is, is the
 * estimator the store makes room for (a count above the stamp) and this stage does not yet hold.
 */
export const RUNTIME_ANSWER_WGSL = wgslBlock(
  'RUNTIME_ANSWER_WGSL',
  [],
  `
/** A pixel's cell of the store: its radiance premultiplied by its confidence, its confidence and the stamp of its epoch. */
struct RtCell{premult:vec3f,confidence:f32,stamp:u32,}
/** A radiance on a shared exponent, nine bits a channel (rgb9e5): the pixel's colour in one word. */
fn rtPackShared(c:vec3f)->u32{
 let v=clamp(c,vec3f(0.0),vec3f(65408.0));
 let top=max(v.x,max(v.y,v.z));
 var exponent=max(-16.0,floor(log2(max(top,1e-30))))+16.0;
 var step=exp2(exponent-24.0);
 if(floor(top/step+0.5)>=512.0){exponent+=1.0;step*=2.0;}
 let m=vec3u(floor(v/step+vec3f(0.5)));
 return m.x|(m.y<<9u)|(m.z<<18u)|(u32(exponent)<<27u);
}
fn rtUnpackShared(w:u32)->vec3f{
 let m=vec3f(f32(w&511u),f32((w>>9u)&511u),f32((w>>18u)&511u));
 return m*exp2(f32(w>>27u)-24.0);
}
/** An epoch's stamp on eight bits, never zero: a pixel never answered holds none. */
fn rtStamp(epoch:u32)->u32{return epoch%255u+1u;}
fn rtCellRead(at:vec2u)->RtCell{
 let a=textureLoad(rtStore,at,0u).x;
 let b=textureLoad(rtStore,at,1u).x;
 return RtCell(rtUnpackShared(a),f32(b&RT_CONFIDENCE_MAX)/f32(RT_CONFIDENCE_MAX),b>>RT_STAMP_SHIFT);
}
fn rtCellWrite(at:vec2u,answer:RtRadiance,stamp:u32){
 let c=u32(round(clamp(answer.confidence,0.0,1.0)*f32(RT_CONFIDENCE_MAX)));
 textureStore(rtStore,at,0u,vec4u(rtPackShared(answer.color*answer.confidence),0u,0u,0u));
 textureStore(rtStore,at,1u,vec4u(c|(stamp<<RT_STAMP_SHIFT),0u,0u,0u));
}
/** What a cell answers: the radiance of the share it holds, and that share. */
fn rtCellAnswer(cell:RtCell)->RtRadiance{
 if(!(cell.confidence>0.0)){return RtRadiance(vec3f(0.0),0.0);}
 return RtRadiance(cell.premult/cell.confidence,min(cell.confidence,1.0));
}
fn rtAnswer(origin:vec3f,direction:vec3f,reach:f32,tangent:f32)->RtRadiance{
 if(rtProxy.instances==0u){return RtRadiance(vec3f(0.0),0.0);}
 let first=rtCalls==0u;
 rtCalls++;
 let stamp=rtStamp(reflectionView.runtime.x);
 var cell=RtCell(vec3f(0.0),0.0,0u);
 if(first){
  cell=rtCellRead(rtPixel);
  if(cell.stamp==stamp){return rtCellAnswer(cell);}
 }
 if(atomicLoad(&rtList[RT_SPENT])<RT_FRAME_WORK){
  let seen=rtRadiance(origin,direction,reach,tangent);
  atomicAdd(&rtList[RT_SPENT],rtWork+rtExtra);
  if(first){
   atomicMax(&rtList[RT_CURSOR],rtRank+1u);
   rtCellWrite(rtPixel,seen,stamp);
  }
  return seen;
 }
 if(!first){return RtRadiance(vec3f(0.0),0.0);}
 atomicAdd(&rtList[RT_LEFT],1u);
 return rtCellAnswer(cell);
}
`,
)
